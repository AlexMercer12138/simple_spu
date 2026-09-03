import * as fs from 'fs';
import * as path from 'path';

export interface PreprocessOptions {
    sourceFileName?: string;
}

export interface PreprocessResult {
    sourceCode: string;
    programName?: string;
    entryLabel?: string;
    origin: number;
    definedSymbols: string[];
}

interface SourceLine {
    text: string;
    fileName?: string;
    lineNum: number;
}

interface EquSymbol {
    name: string;
    value?: string;
}

interface MacroDefinition {
    name: string;
    params: string[];
    body: SourceLine[];
}

interface ConditionalFrame {
    parentActive: boolean;
    active: boolean;
    matched: boolean;
    elseSeen: boolean;
}

interface IncludeRequest {
    resolvedPath: string;
    line: SourceLine;
}

const DIRECTIVE_PATTERN = /^\s*\.(\w+)\b(.*)$/;
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REGISTER_PATTERN = /\br(?:1[0-5]|[0-9])\b/;
const REGISTER_FULL_PATTERN = /^r(?:1[0-5]|[0-9])$/;
const NUMBER_PATTERN = /^[+-]?(?:0[xX][0-9a-fA-F]+|0[bB][01]+|\d+)$/;

export class AssemblerPreprocessor {
    private readonly equs = new Map<string, EquSymbol>();
    private readonly macros = new Map<string, MacroDefinition>();
    private programName: string | undefined;
    private entryLabel: string | undefined;
    private origin: number | undefined;

    preprocess(sourceCode: string, options: PreprocessOptions = {}): PreprocessResult {
        this.equs.clear();
        this.macros.clear();
        this.programName = undefined;
        this.entryLabel = undefined;
        this.origin = undefined;

        const mainFile = options.sourceFileName ? path.resolve(options.sourceFileName) : undefined;
        const includeStack = new Set<string>();
        if (mainFile) {
            includeStack.add(mainFile);
        }

        const lines = this.sourceToLines(sourceCode, mainFile);
        const expanded = this.processFileLines(lines, [], includeStack);

        return {
            sourceCode: expanded.map((line) => line.text).join('\n'),
            programName: this.programName,
            entryLabel: this.entryLabel,
            origin: this.origin ?? 0,
            definedSymbols: Array.from(this.equs.keys()),
        };
    }

    private sourceToLines(sourceCode: string, fileName: string | undefined): SourceLine[] {
        return sourceCode.split(/\r?\n/).map((text, index) => ({
            text,
            fileName,
            lineNum: index + 1,
        }));
    }

    private processFileLines(lines: SourceLine[], callStack: string[], includeStack: Set<string>): SourceLine[] {
        const includeRequests: IncludeRequest[] = [];
        const output = this.processLines(lines, callStack, includeStack, includeRequests);

        for (const request of includeRequests) {
            if (includeStack.has(request.resolvedPath)) {
                const chain = [...includeStack, request.resolvedPath].join(' -> ');
                throw this.error(request.line, `.include cycle detected: ${chain}`);
            }

            let includeCode: string;
            try {
                includeCode = fs.readFileSync(request.resolvedPath, 'utf-8');
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw this.error(request.line, `.include failed to read ${request.resolvedPath}: ${message}`);
            }

            includeStack.add(request.resolvedPath);
            output.push(...this.processFileLines(this.sourceToLines(includeCode, request.resolvedPath), callStack, includeStack));
            includeStack.delete(request.resolvedPath);
        }

        return output;
    }

    private processLines(
        lines: SourceLine[],
        callStack: string[],
        includeStack: Set<string>,
        includeRequests: IncludeRequest[],
    ): SourceLine[] {
        const output: SourceLine[] = [];
        const conditionals: ConditionalFrame[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const directive = this.parseDirective(line.text);

            if (directive && this.isConditionalDirective(directive.name)) {
                this.handleConditionalDirective(directive.name, directive.rest, line, conditionals);
                continue;
            }

            if (!this.isActive(conditionals)) {
                if (directive?.name === 'macro') {
                    const collected = this.collectBlock(lines, i, 'macro', 'endm');
                    i = collected.endIndex;
                } else if (directive?.name === 'rept') {
                    const collected = this.collectBlock(lines, i, 'rept', 'endr');
                    i = collected.endIndex;
                }
                continue;
            }

            if (directive) {
                switch (directive.name) {
                    case 'equ':
                        this.handleEqu(directive.rest, line);
                        continue;
                    case 'prog':
                        this.handleProg(directive.rest, line);
                        continue;
                    case 'entry':
                        this.handleEntry(directive.rest, line);
                        continue;
                    case 'org':
                        this.handleOrigin(directive.rest, line);
                        continue;
                    case 'ifdef':
                    case 'elsif':
                    case 'else':
                    case 'endif':
                        continue;
                    case 'macro': {
                        const collected = this.collectBlock(lines, i, 'macro', 'endm');
                        this.defineMacro(directive.rest, collected.body, line);
                        i = collected.endIndex;
                        continue;
                    }
                    case 'rept': {
                        const collected = this.collectBlock(lines, i, 'rept', 'endr');
                        const count = this.evaluateRepeatCount(directive.rest, line);
                        for (let repeat = 0; repeat < count; repeat++) {
                            output.push(...this.processLines(collected.body, callStack, includeStack, includeRequests));
                        }
                        i = collected.endIndex;
                        continue;
                    }
                    case 'include':
                        includeRequests.push({
                            resolvedPath: this.resolveIncludePath(this.parseIncludePath(directive.rest, line), line.fileName),
                            line,
                        });
                        continue;
                    case 'endm':
                    case 'endr':
                        throw this.error(line, `orphaned .${directive.name}`);
                }
            }

            output.push(...this.expandNormalLine(line, callStack, includeStack, includeRequests));
        }

        const unclosed = conditionals[conditionals.length - 1];
        if (unclosed) {
            throw this.error(lines[lines.length - 1], 'conditional block is missing .endif');
        }

        return output;
    }

    private expandNormalLine(
        line: SourceLine,
        callStack: string[],
        includeStack: Set<string>,
        includeRequests: IncludeRequest[],
    ): SourceLine[] {
        const noComment = stripLineComment(line.text).trim();
        if (!noComment) {
            return [line];
        }

        const macroCall = this.parseMacroCall(noComment);
        if (macroCall && this.macros.has(macroCall.name)) {
            return this.expandMacro(macroCall.name, macroCall.args, line, callStack, includeStack, includeRequests);
        }

        return [{
            ...line,
            text: this.replaceEqusInText(line.text, line),
        }];
    }

    private expandMacro(
        name: string,
        args: string[],
        callLine: SourceLine,
        callStack: string[],
        includeStack: Set<string>,
        includeRequests: IncludeRequest[],
    ): SourceLine[] {
        const macro = this.macros.get(name);
        if (!macro) {
            return [callLine];
        }
        if (callStack.includes(name)) {
            throw this.error(callLine, `.macro recursive call: ${[...callStack, name].join(' -> ')}`);
        }
        if (args.length !== macro.params.length) {
            throw this.error(callLine, `.macro ${name} argument count mismatch: expected ${macro.params.length}, got ${args.length}`);
        }

        const values = new Map<string, string>();
        macro.params.forEach((param, index) => values.set(param, args[index]));
        const substituted = macro.body.map((line) => ({
            ...line,
            text: replaceIdentifiers(line.text, (identifier) => values.get(identifier) ?? identifier),
        }));

        return this.processLines(substituted, [...callStack, name], includeStack, includeRequests);
    }

    private handleEqu(rest: string, line: SourceLine): void {
        const match = rest.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s+(.+))?$/);
        if (!match) {
            throw this.error(line, '.equ syntax: .equ name [value]');
        }

        const name = match[1];
        const rawValue = match[2]?.trim();
        if (!rawValue) {
            this.equs.set(name, { name });
            return;
        }

        const replaced = this.replaceEqusInText(rawValue, line);
        const value = this.resolveEquValue(replaced, line);
        this.equs.set(name, { name, value });
    }

    private handleProg(rest: string, line: SourceLine): void {
        const name = rest.trim();
        if (!IDENTIFIER_PATTERN.test(name)) {
            throw this.error(line, '.prog name must be a valid identifier');
        }
        this.programName = name;
    }

    private handleEntry(rest: string, line: SourceLine): void {
        const label = rest.trim();
        if (!IDENTIFIER_PATTERN.test(label)) {
            throw this.error(line, '.entry label must be a valid identifier');
        }
        if (REGISTER_FULL_PATTERN.test(label)) {
            throw this.error(line, '.entry label cannot be a register name');
        }
        if (this.entryLabel !== undefined) {
            throw this.error(line, `.entry already set to ${this.entryLabel}`);
        }
        this.entryLabel = label;
    }

    private handleOrigin(rest: string, line: SourceLine): void {
        if (this.origin !== undefined) {
            throw this.error(line, `.org already set to ${this.origin}`);
        }
        const expression = this.replaceEqusInText(rest.trim(), line);
        const value = evaluateConstantExpression(expression, (message) => this.error(line, message));
        if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
            throw this.error(line, '.org address must be an unsigned 32-bit integer');
        }
        if ((value & 3) !== 0) {
            throw this.error(line, '.org address must be 4-byte aligned');
        }
        this.origin = value;
    }

    private defineMacro(rest: string, body: SourceLine[], line: SourceLine): void {
        const match = rest.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s*\((.*)\))?$/);
        if (!match) {
            throw this.error(line, '.macro syntax: .macro name(a, b, ...)');
        }

        const name = match[1];
        const params = splitCommaArgs(match[2] ?? '').map((param) => param.trim()).filter(Boolean);
        for (const param of params) {
            if (!IDENTIFIER_PATTERN.test(param)) {
                throw this.error(line, `.macro invalid parameter name: ${param}`);
            }
        }

        this.macros.set(name, { name, params, body });
    }

    private handleConditionalDirective(name: string, rest: string, line: SourceLine, stack: ConditionalFrame[]): void {
        if (name === 'ifdef') {
            const symbol = rest.trim();
            if (!IDENTIFIER_PATTERN.test(symbol)) {
                throw this.error(line, '.ifdef requires a symbol name');
            }
            const parentActive = this.isActive(stack);
            const condition = this.isSymbolDefined(symbol);
            stack.push({
                parentActive,
                active: parentActive && condition,
                matched: condition,
                elseSeen: false,
            });
            return;
        }

        const frame = stack[stack.length - 1];
        if (!frame) {
            throw this.error(line, `orphaned .${name}`);
        }

        if (name === 'elsif') {
            if (frame.elseSeen) {
                throw this.error(line, '.elsif cannot appear after .else');
            }
            const symbol = rest.trim();
            if (!IDENTIFIER_PATTERN.test(symbol)) {
                throw this.error(line, '.elsif requires a symbol name');
            }
            const condition = this.isSymbolDefined(symbol);
            frame.active = frame.parentActive && !frame.matched && condition;
            frame.matched = frame.matched || condition;
            return;
        }

        if (name === 'else') {
            if (frame.elseSeen) {
                throw this.error(line, 'duplicate .else');
            }
            frame.elseSeen = true;
            frame.active = frame.parentActive && !frame.matched;
            frame.matched = true;
            return;
        }

        stack.pop();
    }

    private collectBlock(lines: SourceLine[], startIndex: number, startDirective: string, endDirective: string): { body: SourceLine[]; endIndex: number } {
        const body: SourceLine[] = [];
        let depth = 0;

        for (let i = startIndex + 1; i < lines.length; i++) {
            const directive = this.parseDirective(lines[i].text);
            if (directive?.name === startDirective) {
                depth++;
            }
            if (directive?.name === endDirective) {
                if (depth === 0) {
                    return { body, endIndex: i };
                }
                depth--;
            }
            body.push(lines[i]);
        }

        throw this.error(lines[startIndex], `missing .${endDirective}`);
    }

    private evaluateRepeatCount(rest: string, line: SourceLine): number {
        const replaced = this.replaceEqusInText(rest.trim(), line);
        const value = evaluateConstantExpression(replaced, (message) => this.error(line, message));
        if (!Number.isInteger(value) || value < 0) {
            throw this.error(line, '.rept count must be a non-negative integer');
        }
        return value;
    }

    private replaceEqusInText(text: string, line: SourceLine): string {
        return replaceIdentifiers(text, (identifier) => {
            const symbol = this.equs.get(identifier);
            if (!symbol || symbol.value === undefined) {
                return identifier;
            }
            return symbol.value;
        });
    }

    private resolveEquValue(text: string, line: SourceLine): string {
        const trimmed = text.trim();
        if (!trimmed) {
            throw this.error(line, '.equ value cannot be empty');
        }
        if (REGISTER_FULL_PATTERN.test(trimmed)) {
            return trimmed;
        }
        if (REGISTER_PATTERN.test(trimmed)) {
            throw this.error(line, '.equ expression cannot contain registers');
        }
        if (NUMBER_PATTERN.test(trimmed)) {
            return trimmed;
        }
        return String(evaluateConstantExpression(trimmed, (message) => this.error(line, message)));
    }

    private parseDirective(text: string): { name: string; rest: string } | undefined {
        const match = stripLineComment(text).match(DIRECTIVE_PATTERN);
        if (!match) {
            return undefined;
        }
        return { name: match[1], rest: match[2].trim() };
    }

    private isConditionalDirective(name: string): boolean {
        return ['ifdef', 'elsif', 'else', 'endif'].includes(name);
    }

    private isSymbolDefined(symbol: string): boolean {
        return this.equs.has(symbol) || this.macros.has(symbol);
    }

    private isActive(stack: ConditionalFrame[]): boolean {
        return stack.every((frame) => frame.active);
    }

    private parseIncludePath(rest: string, line: SourceLine): string {
        const match = rest.trim().match(/^(?:"([^"]+)"|<([^>]+)>|(\S+))$/);
        if (!match) {
            throw this.error(line, '.include syntax: .include "file.asm"');
        }
        return match[1] || match[2] || match[3];
    }

    private resolveIncludePath(includePath: string, currentFile: string | undefined): string {
        if (path.isAbsolute(includePath)) {
            return path.resolve(includePath);
        }
        const baseDir = currentFile ? path.dirname(currentFile) : process.cwd();
        return path.resolve(baseDir, includePath);
    }

    private parseMacroCall(text: string): { name: string; args: string[] } | undefined {
        const match = text.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s*\((.*)\))?\s*$/);
        if (!match) {
            return undefined;
        }
        return {
            name: match[1],
            args: splitCommaArgs(match[2] ?? '').map((arg) => arg.trim()).filter((arg) => arg.length > 0),
        };
    }

    private error(line: SourceLine | undefined, message: string): Error {
        if (!line) {
            return new Error(message);
        }
        const location = line.fileName ? `${line.fileName}:${line.lineNum}` : `line ${line.lineNum}`;
        return new Error(`${location}: ${message}`);
    }
}

function stripLineComment(text: string): string {
    const index = text.indexOf('//');
    return index === -1 ? text : text.slice(0, index);
}

function replaceIdentifiers(text: string, replacer: (identifier: string) => string): string {
    return text.replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, replacer);
}

function splitCommaArgs(text: string): string[] {
    if (!text.trim()) {
        return [];
    }

    const args: string[] = [];
    let current = '';
    let depth = 0;
    for (const char of text) {
        if (char === '(') {
            depth++;
        } else if (char === ')') {
            depth--;
        } else if (char === ',' && depth === 0) {
            args.push(current);
            current = '';
            continue;
        }
        current += char;
    }
    args.push(current);
    return args;
}

function evaluateConstantExpression(text: string, makeError: (message: string) => Error): number {
    if (REGISTER_PATTERN.test(text)) {
        throw makeError('.equ/.rept expression cannot contain registers');
    }

    const normalized = text.replace(/0[xX][0-9a-fA-F]+|0[bB][01]+|\d+/g, (literal) => {
        if (/^0[xX]/.test(literal)) {
            return String(Number.parseInt(literal.slice(2), 16));
        }
        if (/^0[bB]/.test(literal)) {
            return String(Number.parseInt(literal.slice(2), 2));
        }
        return literal;
    });

    if (/[A-Za-z_]/.test(normalized)) {
        throw makeError(`constant expression contains an undefined symbol: ${text}`);
    }
    if (!/^[\s()+\-*/%<>&|^~0-9]+$/.test(normalized)) {
        throw makeError(`constant expression contains invalid characters: ${text}`);
    }

    try {
        const fn = Function(`"use strict"; return (${normalized});`);
        const value = fn();
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw makeError(`constant expression result is not numeric: ${text}`);
        }
        return Math.trunc(value);
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('constant expression')) {
            throw error;
        }
        throw makeError(`constant expression cannot be evaluated: ${text}`);
    }
}
