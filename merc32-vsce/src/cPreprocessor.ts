import * as fs from 'fs';
import * as path from 'path';

export interface CSourceLocation {
    file: string;
    line: number;
}

export interface PreprocessedC {
    code: string;
    lineMap: readonly CSourceLocation[];
}

export interface CPreprocessOptions {
    readFile?: (file: string) => string;
    realPath?: (file: string) => string;
    maxIncludeDepth?: number;
}

export class CPreprocessorError extends Error {
    constructor(
        message: string,
        readonly file: string,
        readonly line: number,
        readonly column: number,
    ) {
        super(`${file}:${line}:${column}: ${message}`);
        this.name = 'CPreprocessorError';
    }
}

interface SourcePosition extends CSourceLocation {
    column: number;
}

interface LocatedText {
    text: string;
    origins: readonly SourcePosition[];
    end: SourcePosition;
}

interface MacroDefinition {
    replacement: string;
}

interface PreprocessContext {
    macros: Map<string, MacroDefinition>;
    includeStack: string[];
    output: string[];
    lineMap: CSourceLocation[];
    maxIncludeDepth: number;
}

interface ConditionalFrame {
    parentActive: boolean;
    branchActive: boolean;
    branchTaken: boolean;
    elseSeen: boolean;
}

interface ScannedLine {
    located: LocatedText;
    inBlockComment: boolean;
}

interface ParsedDirective {
    name: string;
    body: LocatedText;
    hashLocation: SourcePosition;
}

const identifierStart = /[A-Za-z_]/;
const identifierPart = /[A-Za-z0-9_]/;

export function preprocessCFile(entryFile: string, options: CPreprocessOptions = {}): PreprocessedC {
    const entryPath = path.resolve(entryFile);
    const maxIncludeDepth = options.maxIncludeDepth ?? 32;
    if (!Number.isSafeInteger(maxIncludeDepth) || maxIncludeDepth < 1 || maxIncludeDepth > 32) {
        throw preprocessorError(
            'maxIncludeDepth must be a finite safe integer in range 1..32',
            { file: entryPath, line: 1, column: 1 },
        );
    }

    const context: PreprocessContext = {
        macros: new Map(),
        includeStack: [],
        output: [],
        lineMap: [],
        maxIncludeDepth,
    };
    const readFile = options.readFile ?? ((file: string) => fs.readFileSync(file, 'utf8'));
    const realPath = options.realPath ?? ((file: string) => fs.realpathSync(file));

    const resolveFile = (file: string, location: SourcePosition): string => {
        try {
            return realPath(path.resolve(file));
        } catch {
            throw preprocessorError(`cannot read include '${file}'`, location);
        }
    };

    const emit = (text: string, location: CSourceLocation): void => {
        context.output.push(text);
        context.lineMap.push(location);
    };

    const processFile = (requestedFile: string, requestedAt: SourcePosition): void => {
        const file = resolveFile(requestedFile, requestedAt);
        if (context.includeStack.includes(file)) {
            throw preprocessorError('include cycle detected', requestedAt);
        }
        if (context.includeStack.length >= context.maxIncludeDepth) {
            throw preprocessorError(`include depth exceeds ${context.maxIncludeDepth}`, requestedAt);
        }
        let source: string;
        try {
            source = readFile(file);
        } catch {
            throw preprocessorError(`cannot read include '${requestedFile}'`, requestedAt);
        }

        context.includeStack.push(file);
        try {
            processSource(file, source, context, emit, processFile);
        } finally {
            context.includeStack.pop();
        }
    };

    processFile(entryPath, { file: entryPath, line: 1, column: 1 });
    return { code: context.output.join('\n'), lineMap: context.lineMap };
}

function processSource(
    file: string,
    source: string,
    context: PreprocessContext,
    emit: (text: string, location: CSourceLocation) => void,
    processFile: (file: string, location: SourcePosition) => void,
): void {
    const conditionals: ConditionalFrame[] = [];
    let inBlockComment = false;
    let suppressDirectiveComment = false;
    const lines = source.split(/\r?\n/);

    for (let index = 0; index < lines.length;) {
        const startInBlockComment = inBlockComment;
        const scan = scanComments(file, index + 1, lines[index], inBlockComment);
        const hashIndex = directiveHashIndex(scan.located.text);
        const active = conditionals.every((frame) => frame.branchActive);

        if (hashIndex !== undefined) {
            const directiveLines = [lines[index]];
            const scans = [scan];
            let logicalInBlockComment = scan.inBlockComment;
            while (hasLineContinuation(scans[scans.length - 1].located.text)) {
                const continuedLineIndex = index + directiveLines.length;
                if (continuedLineIndex >= lines.length) {
                    const continued = scans[scans.length - 1].located;
                    const backslashIndex = continued.text.length - 1;
                    throw preprocessorError('unterminated directive continuation', continued.origins[backslashIndex]);
                }
                directiveLines.push(lines[continuedLineIndex]);
                const continuedScan = scanComments(
                    file,
                    continuedLineIndex + 1,
                    lines[continuedLineIndex],
                    logicalInBlockComment,
                );
                scans.push(continuedScan);
                logicalInBlockComment = continuedScan.inBlockComment;
            }

            const logicalDirective = parseDirective(joinLogicalLine(scans.map((item) => item.located)));
            if (!logicalDirective) {
                throw preprocessorError(
                    'invalid preprocessor directive',
                    scan.located.origins[hashIndex] ?? { file, line: index + 1, column: hashIndex + 1 },
                );
            }

            let directiveLinesEmitted = false;
            const emitDirectiveLines = (): void => {
                if (directiveLinesEmitted) return;
                directiveLines.forEach((line, offset) => {
                    let emitted = '';
                    if (offset === 0 && active && startInBlockComment && !suppressDirectiveComment) {
                        emitted = line.slice(0, hashIndex);
                    }
                    emit(emitted, { file, line: index + offset + 1 });
                });
                directiveLinesEmitted = true;
            };
            handleDirective(
                logicalDirective,
                active,
                conditionals,
                context,
                emitDirectiveLines,
                processFile,
            );
            inBlockComment = logicalInBlockComment;
            suppressDirectiveComment = inBlockComment;
            index += directiveLines.length;
            continue;
        }

        const location = { file, line: index + 1 };
        if (!active) {
            emit('', location);
        } else if (suppressDirectiveComment) {
            emit(scan.located.text, location);
        } else {
            const expanded = expandLine(
                lines[index],
                context.macros,
                { file, line: index + 1, column: 1 },
                [],
                inBlockComment,
            );
            emit(expanded.text, location);
        }
        inBlockComment = scan.inBlockComment;
        if (!inBlockComment) suppressDirectiveComment = false;
        index++;
    }

    if (conditionals.length !== 0) {
        throw preprocessorError('unterminated conditional', { file, line: lines.length, column: 1 });
    }
}

function handleDirective(
    directive: ParsedDirective,
    active: boolean,
    conditionals: ConditionalFrame[],
    context: PreprocessContext,
    emit: (text: string, location: CSourceLocation) => void,
    processFile: (file: string, location: SourcePosition) => void,
): void {
    const { name, body, hashLocation } = directive;
    if (name === 'if') {
        const parentActive = active;
        const condition = parentActive && evaluateIfExpression(body, context.macros) !== 0;
        conditionals.push({
            parentActive,
            branchActive: condition,
            branchTaken: condition,
            elseSeen: false,
        });
        emit('', hashLocation);
        return;
    }

    if (name === 'ifdef' || name === 'ifndef') {
        const macro = parseSingleIdentifier(body, hashLocation, `#${name} requires a macro name`);
        const parentActive = active;
        const condition = name === 'ifdef' ? context.macros.has(macro) : !context.macros.has(macro);
        const branchActive = parentActive && condition;
        conditionals.push({
            parentActive,
            branchActive,
            branchTaken: branchActive,
            elseSeen: false,
        });
        emit('', hashLocation);
        return;
    }

    if (name === 'else') {
        if (body.text.trim() !== '') {
            throw preprocessorError('#else does not take arguments', firstNonWhitespaceLocation(body, hashLocation));
        }
        const frame = conditionals[conditionals.length - 1];
        if (!frame) throw preprocessorError('unexpected #else', hashLocation);
        if (frame.elseSeen) throw preprocessorError('duplicate #else', hashLocation);
        frame.elseSeen = true;
        frame.branchActive = frame.parentActive && !frame.branchTaken;
        frame.branchTaken = true;
        emit('', hashLocation);
        return;
    }

    if (name === 'endif') {
        if (body.text.trim() !== '') {
            throw preprocessorError('#endif does not take arguments', firstNonWhitespaceLocation(body, hashLocation));
        }
        if (conditionals.length === 0) throw preprocessorError('unexpected #endif', hashLocation);
        conditionals.pop();
        emit('', hashLocation);
        return;
    }

    if (!active) {
        emit('', hashLocation);
        return;
    }

    if (name === 'define') {
        const start = skipWhitespace(body.text, 0);
        if (start >= body.text.length || !identifierStart.test(body.text[start])) {
            throw preprocessorError('#define requires a macro name', locationAt(body, start, hashLocation));
        }
        let end = start + 1;
        while (end < body.text.length && identifierPart.test(body.text[end])) end++;
        if (body.text[end] === '(') {
            throw preprocessorError('function-style macros are not supported', locationAt(body, end, hashLocation));
        }
        const replacementStart = skipWhitespace(body.text, end);
        context.macros.set(body.text.slice(start, end), { replacement: body.text.slice(replacementStart) });
        emit('', hashLocation);
        return;
    }

    if (name === 'undef') {
        context.macros.delete(parseSingleIdentifier(body, hashLocation, '#undef requires a macro name'));
        emit('', hashLocation);
        return;
    }

    if (name === 'include') {
        const start = skipWhitespace(body.text, 0);
        const includeLocation = locationAt(body, start, hashLocation);
        if (body.text[start] !== '"') {
            throw preprocessorError('only quoted includes are supported', includeLocation);
        }
        const end = body.text.indexOf('"', start + 1);
        if (end === -1 || body.text.slice(end + 1).trim() !== '') {
            throw preprocessorError('only quoted includes are supported', includeLocation);
        }
        const includePath = body.text.slice(start + 1, end);
        emit('', hashLocation);
        processFile(path.resolve(path.dirname(hashLocation.file), includePath), includeLocation);
        return;
    }

    throw preprocessorError(`unsupported preprocessor directive '#${name}'`, hashLocation);
}

function scanComments(file: string, line: number, text: string, initiallyInBlockComment: boolean): ScannedLine {
    const chars = [...text];
    const origins = chars.map((_, index) => ({ file, line, column: index + 1 }));
    let index = 0;
    let inBlockComment = initiallyInBlockComment;
    while (index < chars.length) {
        if (inBlockComment) {
            if (text.startsWith('*/', index)) {
                chars[index] = ' ';
                chars[index + 1] = ' ';
                index += 2;
                inBlockComment = false;
            } else {
                chars[index++] = ' ';
            }
            continue;
        }
        if (text.startsWith('/*', index)) {
            chars[index] = ' ';
            chars[index + 1] = ' ';
            index += 2;
            inBlockComment = true;
            continue;
        }
        if (text.startsWith('//', index)) {
            while (index < chars.length) chars[index++] = ' ';
            break;
        }
        if (text[index] === '"' || text[index] === "'") {
            index = literalEnd(text, index);
            continue;
        }
        index++;
    }
    return {
        located: {
            text: chars.join(''),
            origins,
            end: { file, line, column: text.length + 1 },
        },
        inBlockComment,
    };
}

function directiveHashIndex(text: string): number | undefined {
    const index = skipWhitespace(text, 0);
    return text[index] === '#' ? index : undefined;
}

function parseDirective(line: LocatedText): ParsedDirective | undefined {
    const hashIndex = directiveHashIndex(line.text);
    if (hashIndex === undefined) return undefined;
    let index = skipWhitespace(line.text, hashIndex + 1);
    if (index >= line.text.length || !identifierStart.test(line.text[index])) return undefined;
    const nameStart = index++;
    while (index < line.text.length && identifierPart.test(line.text[index])) index++;
    return {
        name: line.text.slice(nameStart, index),
        body: sliceLocated(line, index),
        hashLocation: line.origins[hashIndex],
    };
}

function hasLineContinuation(text: string): boolean {
    let trailingBackslashes = 0;
    for (let index = text.length - 1; index >= 0 && text[index] === '\\'; index--) trailingBackslashes++;
    return trailingBackslashes % 2 === 1;
}

function joinLogicalLine(lines: readonly LocatedText[]): LocatedText {
    let text = '';
    const origins: SourcePosition[] = [];
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const continued = index < lines.length - 1 && hasLineContinuation(line.text);
        const length = line.text.length - (continued ? 1 : 0);
        text += line.text.slice(0, length);
        origins.push(...line.origins.slice(0, length));
    }
    return { text, origins, end: lines[lines.length - 1].end };
}

function parseSingleIdentifier(body: LocatedText, fallback: SourcePosition, message: string): string {
    const start = skipWhitespace(body.text, 0);
    if (start >= body.text.length || !identifierStart.test(body.text[start])) {
        throw preprocessorError(message, locationAt(body, start, fallback));
    }
    let end = start + 1;
    while (end < body.text.length && identifierPart.test(body.text[end])) end++;
    if (body.text.slice(end).trim() !== '') {
        throw preprocessorError(message, firstNonWhitespaceLocation(sliceLocated(body, end), locationAt(body, end, fallback)));
    }
    return body.text.slice(start, end);
}

type IfTokenKind = 'number' | 'identifier' | 'operator' | 'leftParen' | 'rightParen' | 'end';

interface IfToken {
    kind: IfTokenKind;
    text: string;
    location: SourcePosition;
}

function evaluateIfExpression(expression: LocatedText, macros: Map<string, MacroDefinition>): number {
    const rawTokens = tokenizeIfExpression(expression);
    const expandedTokens = expandIfTokens(rawTokens.slice(0, -1), macros, []);
    expandedTokens.push(rawTokens[rawTokens.length - 1]);
    return new IfExpressionParser(expandedTokens, macros).parse();
}

function expandIfTokens(
    tokens: readonly IfToken[],
    macros: Map<string, MacroDefinition>,
    expansionStack: readonly string[],
): IfToken[] {
    const result: IfToken[] = [];
    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        if (token.kind === 'identifier' && token.text === 'defined') {
            result.push(token);
            const next = tokens[index + 1];
            if (next?.kind === 'leftParen') {
                result.push(next);
                if (tokens[index + 2]) result.push(tokens[index + 2]);
                if (tokens[index + 3]) result.push(tokens[index + 3]);
                index += 3;
            } else if (next) {
                result.push(next);
                index++;
            }
            continue;
        }
        if (token.kind !== 'identifier' || !macros.has(token.text)) {
            result.push(token);
            continue;
        }
        if (expansionStack.includes(token.text)) {
            throw preprocessorError(`recursive macro expansion for '${token.text}'`, token.location);
        }
        if (expansionStack.length >= 64) {
            throw preprocessorError('macro expansion depth exceeds 64', token.location);
        }
        const replacement = macros.get(token.text)!.replacement;
        const replacementTokens = tokenizeIfExpression(locatedAtUse(replacement, token.location)).slice(0, -1);
        result.push(...expandIfTokens(replacementTokens, macros, [...expansionStack, token.text]));
    }
    return result;
}

function tokenizeIfExpression(expression: LocatedText): IfToken[] {
    const tokens: IfToken[] = [];
    let index = 0;
    const operators = ['&&', '||', '<<', '>>', '<=', '>=', '==', '!=', '*', '/', '%', '+', '-', '<', '>', '&', '^', '|', '!', '~'];
    while (index < expression.text.length) {
        if (/\s/.test(expression.text[index])) {
            index++;
            continue;
        }
        const location = locationAt(expression, index, expression.end);
        if (identifierStart.test(expression.text[index])) {
            const start = index++;
            while (index < expression.text.length && identifierPart.test(expression.text[index])) index++;
            tokens.push({ kind: 'identifier', text: expression.text.slice(start, index), location });
            continue;
        }
        if (/\d/.test(expression.text[index])) {
            const start = index;
            if (expression.text.startsWith('0x', index) || expression.text.startsWith('0X', index)) {
                index += 2;
                const digits = index;
                while (index < expression.text.length && /[0-9a-fA-F]/.test(expression.text[index])) index++;
                if (index === digits) throw preprocessorError('invalid integer literal in #if expression', location);
            } else {
                while (index < expression.text.length && /\d/.test(expression.text[index])) index++;
            }
            tokens.push({ kind: 'number', text: expression.text.slice(start, index), location });
            continue;
        }
        if (expression.text[index] === '(') {
            tokens.push({ kind: 'leftParen', text: '(', location });
            index++;
            continue;
        }
        if (expression.text[index] === ')') {
            tokens.push({ kind: 'rightParen', text: ')', location });
            index++;
            continue;
        }
        const operator = operators.find((candidate) => expression.text.startsWith(candidate, index));
        if (!operator) throw preprocessorError(`invalid token '${expression.text[index]}' in #if expression`, location);
        tokens.push({ kind: 'operator', text: operator, location });
        index += operator.length;
    }
    tokens.push({ kind: 'end', text: '', location: expression.end });
    return tokens;
}

class IfExpressionParser {
    private index = 0;

    constructor(
        private readonly tokens: readonly IfToken[],
        private readonly macros: Map<string, MacroDefinition>,
    ) {}

    parse(): number {
        const value = this.parseBinary(0, false);
        if (this.current().kind !== 'end') {
            throw preprocessorError('unexpected token in #if expression', this.current().location);
        }
        return value;
    }

    private parseBinary(minimumPrecedence: number, suppressErrors: boolean): number {
        let left = this.parseUnary(suppressErrors);
        while (this.current().kind === 'operator') {
            const operator = this.current();
            const precedence = binaryPrecedence(operator.text);
            if (precedence < minimumPrecedence) break;
            this.index++;
            const suppressRight = suppressErrors || (operator.text === '&&' && left === 0) || (operator.text === '||' && left !== 0);
            const right = this.parseBinary(precedence + 1, suppressRight);
            left = applyIfBinaryOperator(operator, left, right, suppressErrors);
        }
        return left;
    }

    private parseUnary(suppressErrors: boolean): number {
        const token = this.current();
        if (token.kind === 'operator' && ['!', '~', '+', '-'].includes(token.text)) {
            this.index++;
            const value = this.parseUnary(suppressErrors);
            switch (token.text) {
                case '!': return value === 0 ? 1 : 0;
                case '~': return ~value;
                case '+': return value | 0;
                case '-': return -value | 0;
            }
        }
        if (token.kind === 'number') {
            this.index++;
            return parseIfIntegerLiteral(token.text);
        }
        if (token.kind === 'identifier') {
            this.index++;
            if (token.text === 'defined') return this.parseDefined();
            return 0;
        }
        if (token.kind === 'leftParen') {
            this.index++;
            const value = this.parseBinary(0, suppressErrors);
            if (this.current().kind !== 'rightParen') {
                throw preprocessorError('expected closing parenthesis in #if expression', this.current().location);
            }
            this.index++;
            return value;
        }
        throw preprocessorError('expected expression in #if', token.location);
    }

    private parseDefined(): number {
        let name: string;
        if (this.current().kind === 'leftParen') {
            this.index++;
            const identifier = this.current();
            if (identifier.kind !== 'identifier') throw preprocessorError('defined requires a macro name', identifier.location);
            name = identifier.text;
            this.index++;
            if (this.current().kind !== 'rightParen') throw preprocessorError('defined requires a macro name', this.current().location);
            this.index++;
        } else {
            const identifier = this.current();
            if (identifier.kind !== 'identifier') throw preprocessorError('defined requires a macro name', identifier.location);
            name = identifier.text;
            this.index++;
        }
        return this.macros.has(name) ? 1 : 0;
    }

    private current(): IfToken {
        return this.tokens[this.index];
    }
}

function parseIfIntegerLiteral(text: string): number {
    const hexadecimal = text.startsWith('0x') || text.startsWith('0X');
    const digits = hexadecimal ? text.slice(2) : text;
    const base = hexadecimal ? 16 : 10;
    let value = 0;
    for (const digit of digits) {
        const parsed = Number.parseInt(digit, base);
        value = (value * base + parsed) | 0;
    }
    return value;
}

function binaryPrecedence(operator: string): number {
    switch (operator) {
        case '||': return 1;
        case '&&': return 2;
        case '|': return 3;
        case '^': return 4;
        case '&': return 5;
        case '==': case '!=': return 6;
        case '<': case '<=': case '>': case '>=': return 7;
        case '<<': case '>>': return 8;
        case '+': case '-': return 9;
        case '*': case '/': case '%': return 10;
        default: return -1;
    }
}

function applyIfBinaryOperator(operator: IfToken, left: number, right: number, suppressErrors: boolean): number {
    switch (operator.text) {
        case '*': return Math.imul(left, right);
        case '/':
            if (right === 0) {
                if (suppressErrors) return 0;
                throw preprocessorError('division by zero in #if expression', operator.location);
            }
            return (left / right) | 0;
        case '%':
            if (right === 0) {
                if (suppressErrors) return 0;
                throw preprocessorError('remainder by zero in #if expression', operator.location);
            }
            return left % right;
        case '+': return (left + right) | 0;
        case '-': return (left - right) | 0;
        case '<<': return left << (right & 31);
        case '>>': return left >> (right & 31);
        case '<': return left < right ? 1 : 0;
        case '<=': return left <= right ? 1 : 0;
        case '>': return left > right ? 1 : 0;
        case '>=': return left >= right ? 1 : 0;
        case '==': return left === right ? 1 : 0;
        case '!=': return left !== right ? 1 : 0;
        case '&': return left & right;
        case '^': return left ^ right;
        case '|': return left | right;
        case '&&': return left !== 0 && right !== 0 ? 1 : 0;
        case '||': return left !== 0 || right !== 0 ? 1 : 0;
        default: throw preprocessorError('unsupported operator in #if expression', operator.location);
    }
}

interface ExpandedLine {
    text: string;
    inBlockComment: boolean;
}

function expandLine(
    text: string,
    macros: Map<string, MacroDefinition>,
    location: SourcePosition,
    expansionStack: readonly string[],
    initiallyInBlockComment: boolean,
    fixedUseLocation?: SourcePosition,
): ExpandedLine {
    let result = '';
    let index = 0;
    let inBlockComment = initiallyInBlockComment;

    while (index < text.length) {
        if (inBlockComment) {
            const end = text.indexOf('*/', index);
            if (end === -1) return { text: result + text.slice(index), inBlockComment: true };
            result += text.slice(index, end + 2);
            index = end + 2;
            inBlockComment = false;
            continue;
        }
        if (text.startsWith('/*', index)) {
            const end = text.indexOf('*/', index + 2);
            if (end === -1) return { text: result + text.slice(index), inBlockComment: true };
            result += text.slice(index, end + 2);
            index = end + 2;
            continue;
        }
        if (text.startsWith('//', index)) return { text: result + text.slice(index), inBlockComment: false };
        if (text[index] === '"' || text[index] === "'") {
            const end = literalEnd(text, index);
            result += text.slice(index, end);
            index = end;
            continue;
        }
        if (identifierStart.test(text[index])) {
            let end = index + 1;
            while (end < text.length && identifierPart.test(text[end])) end++;
            const name = text.slice(index, end);
            const useLocation = fixedUseLocation ?? { ...location, column: location.column + index };
            result += macros.has(name)
                ? expandMacro(name, macros, useLocation, expansionStack)
                : name;
            index = end;
            continue;
        }
        result += text[index++];
    }

    return { text: result, inBlockComment: false };
}

function expandMacro(
    name: string,
    macros: Map<string, MacroDefinition>,
    location: SourcePosition,
    expansionStack: readonly string[],
): string {
    if (expansionStack.includes(name)) {
        throw preprocessorError(`recursive macro expansion for '${name}'`, location);
    }
    if (expansionStack.length >= 64) {
        throw preprocessorError('macro expansion depth exceeds 64', location);
    }
    return expandLine(
        macros.get(name)!.replacement,
        macros,
        location,
        [...expansionStack, name],
        false,
        location,
    ).text;
}

function literalEnd(text: string, start: number): number {
    const quote = text[start];
    let index = start + 1;
    while (index < text.length) {
        if (text[index] === '\\') index += 2;
        else if (text[index++] === quote) break;
    }
    return Math.min(index, text.length);
}

function locatedAtUse(text: string, location: SourcePosition): LocatedText {
    return {
        text,
        origins: [...text].map(() => location),
        end: location,
    };
}

function sliceLocated(text: LocatedText, start: number, end = text.text.length): LocatedText {
    return {
        text: text.text.slice(start, end),
        origins: text.origins.slice(start, end),
        end: end < text.text.length ? text.origins[end] : text.end,
    };
}

function locationAt(text: LocatedText, index: number, fallback: SourcePosition): SourcePosition {
    return text.origins[index] ?? text.end ?? fallback;
}

function firstNonWhitespaceLocation(text: LocatedText, fallback: SourcePosition): SourcePosition {
    return locationAt(text, skipWhitespace(text.text, 0), fallback);
}

function skipWhitespace(text: string, start: number): number {
    let index = start;
    while (index < text.length && /\s/.test(text[index])) index++;
    return index;
}

function preprocessorError(message: string, location: SourcePosition): CPreprocessorError {
    return new CPreprocessorError(message, location.file, location.line, location.column);
}
