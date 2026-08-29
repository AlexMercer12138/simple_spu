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

interface PreprocessContext {
    macros: Map<string, string>;
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

interface ExpandedLine {
    text: string;
    inBlockComment: boolean;
}

const identifierStart = /[A-Za-z_]/;
const identifierPart = /[A-Za-z0-9_]/;

export function preprocessCFile(entryFile: string, options: CPreprocessOptions = {}): PreprocessedC {
    const context: PreprocessContext = {
        macros: new Map(),
        includeStack: [],
        output: [],
        lineMap: [],
        maxIncludeDepth: Math.min(options.maxIncludeDepth ?? 32, 32),
    };
    const readFile = options.readFile ?? ((file: string) => fs.readFileSync(file, 'utf8'));
    const realPath = options.realPath ?? ((file: string) => fs.realpathSync(file));

    const resolveFile = (file: string, location: CSourceLocation): string => {
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

    const processFile = (requestedFile: string, requestedAt: CSourceLocation): void => {
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

    const entryPath = path.resolve(entryFile);
    processFile(entryPath, { file: entryPath, line: 1 });
    return { code: context.output.join('\n'), lineMap: context.lineMap };
}

function processSource(
    file: string,
    source: string,
    context: PreprocessContext,
    emit: (text: string, location: CSourceLocation) => void,
    processFile: (file: string, location: CSourceLocation) => void,
): void {
    const conditionals: ConditionalFrame[] = [];
    let inBlockComment = false;
    const lines = source.split(/\r?\n/);

    for (let index = 0; index < lines.length;) {
        const line = lines[index];
        const location = { file, line: index + 1 };
        const directive = !inBlockComment ? parseDirective(line) : undefined;
        const active = conditionals.every((frame) => frame.branchActive);

        if (directive) {
            const directiveLines = [line];
            while (hasLineContinuation(directiveLines[directiveLines.length - 1]) && index + directiveLines.length < lines.length) {
                directiveLines.push(lines[index + directiveLines.length]);
            }
            const logicalDirective = parseDirective(joinLogicalLine(directiveLines));
            if (!logicalDirective) {
                throw preprocessorError('invalid preprocessor directive', location);
            }

            let directiveLinesEmitted = false;
            const emitDirectiveLines = (): void => {
                if (!directiveLinesEmitted) {
                    directiveLines.forEach((_, offset) => emit('', { file, line: index + offset + 1 }));
                    directiveLinesEmitted = true;
                }
            };
            handleDirective(
                logicalDirective.name,
                logicalDirective.body,
                location,
                active,
                conditionals,
                context,
                emitDirectiveLines,
                processFile,
            );
            for (const directiveLine of directiveLines) {
                inBlockComment = advanceBlockCommentState(directiveLine, inBlockComment);
            }
            index += directiveLines.length;
            continue;
        }

        if (!active) {
            emit('', location);
            inBlockComment = advanceBlockCommentState(line, inBlockComment);
            index++;
            continue;
        }

        const expanded = expandLine(line, context.macros, location, [], inBlockComment);
        emit(expanded.text, location);
        inBlockComment = expanded.inBlockComment;
        index++;
    }

    if (conditionals.length !== 0) {
        throw preprocessorError('unterminated conditional', { file, line: lines.length });
    }
}

function handleDirective(
    name: string,
    body: string,
    location: CSourceLocation,
    active: boolean,
    conditionals: ConditionalFrame[],
    context: PreprocessContext,
    emit: (text: string, location: CSourceLocation) => void,
    processFile: (file: string, location: CSourceLocation) => void,
): void {
    if (name === 'if') {
        const parentActive = active;
        const condition = parentActive && evaluateIfExpression(body, context.macros, location) !== 0;
        conditionals.push({
            parentActive,
            branchActive: condition,
            branchTaken: condition,
            elseSeen: false,
        });
        emit('', location);
        return;
    }

    if (name === 'ifdef' || name === 'ifndef') {
        const macro = parseSingleIdentifier(body, location, `#${name} requires a macro name`);
        const parentActive = active;
        const condition = name === 'ifdef' ? context.macros.has(macro) : !context.macros.has(macro);
        const branchActive = parentActive && condition;
        conditionals.push({
            parentActive,
            branchActive,
            branchTaken: branchActive,
            elseSeen: false,
        });
        emit('', location);
        return;
    }

    if (name === 'else') {
        if (body.trim() !== '') {
            throw preprocessorError('#else does not take arguments', location);
        }
        const frame = conditionals[conditionals.length - 1];
        if (!frame) {
            throw preprocessorError('unexpected #else', location);
        }
        if (frame.elseSeen) {
            throw preprocessorError('duplicate #else', location);
        }
        frame.elseSeen = true;
        frame.branchActive = frame.parentActive && !frame.branchTaken;
        frame.branchTaken = true;
        emit('', location);
        return;
    }

    if (name === 'endif') {
        if (body.trim() !== '') {
            throw preprocessorError('#endif does not take arguments', location);
        }
        if (conditionals.length === 0) {
            throw preprocessorError('unexpected #endif', location);
        }
        conditionals.pop();
        emit('', location);
        return;
    }

    if (!active) {
        emit('', location);
        return;
    }

    if (name === 'define') {
        const definition = body.match(/^\s*([A-Za-z_]\w*)([\s\S]*)$/);
        if (!definition) {
            throw preprocessorError('#define requires a macro name', location);
        }
        if (definition[2].startsWith('(')) {
            throw preprocessorError('function-style macros are not supported', location);
        }
        context.macros.set(definition[1], definition[2].trimStart());
        emit('', location);
        return;
    }

    if (name === 'undef') {
        context.macros.delete(parseSingleIdentifier(body, location, '#undef requires a macro name'));
        emit('', location);
        return;
    }

    if (name === 'include') {
        const include = body.match(/^\s*"([^"]+)"\s*$/);
        if (!include) {
            throw preprocessorError('only quoted includes are supported', location);
        }
        emit('', location);
        processFile(path.resolve(path.dirname(location.file), include[1]), location);
        return;
    }

    throw preprocessorError(`unsupported preprocessor directive '#${name}'`, location);
}

function parseDirective(line: string): { name: string; body: string } | undefined {
    const match = line.match(/^\s*#\s*([A-Za-z_]\w*)([\s\S]*)$/);
    return match ? { name: match[1], body: match[2] } : undefined;
}

function hasLineContinuation(line: string): boolean {
    let trailingBackslashes = 0;
    for (let index = line.length - 1; index >= 0 && line[index] === '\\'; index--) {
        trailingBackslashes++;
    }
    return trailingBackslashes % 2 === 1;
}

function joinLogicalLine(lines: readonly string[]): string {
    return lines
        .map((line, index) => index < lines.length - 1 && hasLineContinuation(line) ? line.slice(0, -1) : line)
        .join('');
}

function parseSingleIdentifier(body: string, location: CSourceLocation, message: string): string {
    const match = body.match(/^\s*([A-Za-z_]\w*)\s*$/);
    if (!match) {
        throw preprocessorError(message, location);
    }
    return match[1];
}

type IfTokenKind = 'number' | 'identifier' | 'operator' | 'leftParen' | 'rightParen' | 'end';

interface IfToken {
    kind: IfTokenKind;
    text: string;
}

function evaluateIfExpression(expression: string, macros: Map<string, string>, location: CSourceLocation): number {
    const protectedDefined = protectDefinedOperands(expression, location);
    const expanded = expandLine(protectedDefined.text, macros, location, [], false).text;
    const restored = restoreDefinedOperands(expanded, protectedDefined.operands);
    return new IfExpressionParser(tokenizeIfExpression(restored, location), macros, location).parse();
}

function protectDefinedOperands(expression: string, location: CSourceLocation): { text: string; operands: string[] } {
    const operands: string[] = [];
    const text = expression.replace(/\bdefined\s*(?:\(\s*([A-Za-z_]\w*)\s*\)|\s+([A-Za-z_]\w*))/g, (_match, parenthesized, bare) => {
        const operand = parenthesized ?? bare;
        if (!operand) {
            throw preprocessorError('defined requires a macro name', location);
        }
        const index = operands.push(operand) - 1;
        return `__MERC32_DEFINED_OPERAND_${index}__`;
    });
    if (/\bdefined\b/.test(text)) {
        throw preprocessorError('defined requires a macro name', location);
    }
    return { text, operands };
}

function restoreDefinedOperands(text: string, operands: readonly string[]): string {
    return text.replace(/__MERC32_DEFINED_OPERAND_(\d+)__/g, (_match, index) => `defined(${operands[Number(index)]})`);
}

function tokenizeIfExpression(expression: string, location: CSourceLocation): IfToken[] {
    const tokens: IfToken[] = [];
    let index = 0;
    const operators = ['&&', '||', '<<', '>>', '<=', '>=', '==', '!=', '*', '/', '%', '+', '-', '<', '>', '&', '^', '|', '!', '~'];
    while (index < expression.length) {
        if (/\s/.test(expression[index])) {
            index++;
            continue;
        }
        if (identifierStart.test(expression[index])) {
            const start = index++;
            while (index < expression.length && identifierPart.test(expression[index])) index++;
            tokens.push({ kind: 'identifier', text: expression.slice(start, index) });
            continue;
        }
        if (/\d/.test(expression[index])) {
            const start = index;
            if (expression.startsWith('0x', index) || expression.startsWith('0X', index)) {
                index += 2;
                const digits = index;
                while (index < expression.length && /[0-9a-fA-F]/.test(expression[index])) index++;
                if (index === digits) throw preprocessorError('invalid integer literal in #if expression', location);
            } else {
                while (index < expression.length && /\d/.test(expression[index])) index++;
            }
            tokens.push({ kind: 'number', text: expression.slice(start, index) });
            continue;
        }
        if (expression[index] === '(') {
            tokens.push({ kind: 'leftParen', text: '(' });
            index++;
            continue;
        }
        if (expression[index] === ')') {
            tokens.push({ kind: 'rightParen', text: ')' });
            index++;
            continue;
        }
        const operator = operators.find((candidate) => expression.startsWith(candidate, index));
        if (!operator) throw preprocessorError(`invalid token '${expression[index]}' in #if expression`, location);
        tokens.push({ kind: 'operator', text: operator });
        index += operator.length;
    }
    tokens.push({ kind: 'end', text: '' });
    return tokens;
}

class IfExpressionParser {
    private index = 0;

    constructor(
        private readonly tokens: readonly IfToken[],
        private readonly macros: Map<string, string>,
        private readonly location: CSourceLocation,
    ) {}

    parse(): number {
        const value = this.parseBinary(0, false);
        if (this.current().kind !== 'end') {
            throw preprocessorError('unexpected token in #if expression', this.location);
        }
        return value;
    }

    private parseBinary(minimumPrecedence: number, suppressErrors: boolean): number {
        let left = this.parseUnary(suppressErrors);
        while (this.current().kind === 'operator') {
            const operator = this.current().text;
            const precedence = binaryPrecedence(operator);
            if (precedence < minimumPrecedence) break;
            this.index++;
            const suppressRight = suppressErrors || (operator === '&&' && left === 0) || (operator === '||' && left !== 0);
            const right = this.parseBinary(precedence + 1, suppressRight);
            left = applyIfBinaryOperator(operator, left, right, this.location, suppressErrors);
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
                throw preprocessorError('expected closing parenthesis in #if expression', this.location);
            }
            this.index++;
            return value;
        }
        throw preprocessorError('expected expression in #if', this.location);
    }

    private parseDefined(): number {
        let name: string;
        if (this.current().kind === 'leftParen') {
            this.index++;
            const identifier = this.current();
            if (identifier.kind !== 'identifier') throw preprocessorError('defined requires a macro name', this.location);
            name = identifier.text;
            this.index++;
            if (this.current().kind !== 'rightParen') throw preprocessorError('defined requires a macro name', this.location);
            this.index++;
        } else {
            const identifier = this.current();
            if (identifier.kind !== 'identifier') throw preprocessorError('defined requires a macro name', this.location);
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

function applyIfBinaryOperator(operator: string, left: number, right: number, location: CSourceLocation, suppressErrors: boolean): number {
    switch (operator) {
        case '*': return Math.imul(left, right);
        case '/':
            if (right === 0) {
                if (suppressErrors) return 0;
                throw preprocessorError('division by zero in #if expression', location);
            }
            return (left / right) | 0;
        case '%':
            if (right === 0) {
                if (suppressErrors) return 0;
                throw preprocessorError('remainder by zero in #if expression', location);
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
        default: throw preprocessorError('unsupported operator in #if expression', location);
    }
}

function expandLine(
    text: string,
    macros: Map<string, string>,
    location: CSourceLocation,
    expansionStack: readonly string[],
    initiallyInBlockComment: boolean,
): ExpandedLine {
    let result = '';
    let index = 0;
    let inBlockComment = initiallyInBlockComment;

    while (index < text.length) {
        if (inBlockComment) {
            const end = text.indexOf('*/', index);
            if (end === -1) {
                return { text: result + text.slice(index), inBlockComment: true };
            }
            result += text.slice(index, end + 2);
            index = end + 2;
            inBlockComment = false;
            continue;
        }

        if (text.startsWith('/*', index)) {
            const end = text.indexOf('*/', index + 2);
            if (end === -1) {
                return { text: result + text.slice(index), inBlockComment: true };
            }
            result += text.slice(index, end + 2);
            index = end + 2;
            continue;
        }
        if (text.startsWith('//', index)) {
            return { text: result + text.slice(index), inBlockComment: false };
        }
        if (text[index] === '"' || text[index] === "'") {
            const end = literalEnd(text, index);
            result += text.slice(index, end);
            index = end;
            continue;
        }
        if (identifierStart.test(text[index])) {
            let end = index + 1;
            while (end < text.length && identifierPart.test(text[end])) {
                end++;
            }
            const name = text.slice(index, end);
            result += macros.has(name)
                ? expandMacro(name, macros, location, expansionStack)
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
    macros: Map<string, string>,
    location: CSourceLocation,
    expansionStack: readonly string[],
): string {
    if (expansionStack.includes(name)) {
        throw preprocessorError(`recursive macro expansion for '${name}'`, location);
    }
    if (expansionStack.length >= 64) {
        throw preprocessorError('macro expansion depth exceeds 64', location);
    }
    return expandLine(macros.get(name)!, macros, location, [...expansionStack, name], false).text;
}

function literalEnd(text: string, start: number): number {
    const quote = text[start];
    let index = start + 1;
    while (index < text.length) {
        if (text[index] === '\\') {
            index += 2;
        } else if (text[index++] === quote) {
            break;
        }
    }
    return Math.min(index, text.length);
}

function advanceBlockCommentState(text: string, initiallyInBlockComment: boolean): boolean {
    let index = 0;
    let inBlockComment = initiallyInBlockComment;
    while (index < text.length) {
        if (inBlockComment) {
            const end = text.indexOf('*/', index);
            if (end === -1) return true;
            index = end + 2;
            inBlockComment = false;
            continue;
        }
        if (text.startsWith('/*', index)) {
            index += 2;
            inBlockComment = true;
            continue;
        }
        if (text.startsWith('//', index)) return false;
        if (text[index] === '"' || text[index] === "'") {
            index = literalEnd(text, index);
            continue;
        }
        index++;
    }
    return inBlockComment;
}

function preprocessorError(message: string, location: CSourceLocation): CPreprocessorError {
    return new CPreprocessorError(message, location.file, location.line, 1);
}
