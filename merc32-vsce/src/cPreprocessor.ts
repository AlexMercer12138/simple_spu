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
    active: boolean;
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
        maxIncludeDepth: options.maxIncludeDepth ?? 64,
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

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const location = { file, line: index + 1 };
        const directive = !inBlockComment ? parseDirective(line) : undefined;
        const active = conditionals.every((frame) => frame.active);

        if (directive) {
            handleDirective(directive.name, directive.body, location, active, conditionals, context, emit, processFile);
            continue;
        }

        if (!active) {
            emit('', location);
            continue;
        }

        const expanded = expandLine(line, context.macros, location, [], inBlockComment);
        emit(expanded.text, location);
        inBlockComment = expanded.inBlockComment;
    }

    if (conditionals.length !== 0) {
        throw preprocessorError('unterminated include guard', { file, line: lines.length });
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
    if (name === 'ifndef') {
        const macro = parseSingleIdentifier(body, location, '#ifndef requires a macro name');
        const parentActive = active;
        const exists = context.macros.has(macro);
        conditionals.push({ parentActive, active: parentActive && !exists });
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

    if (name === 'define') {
        if (active) {
            const definition = body.match(/^\s*([A-Za-z_]\w*)([\s\S]*)$/);
            if (!definition) {
                throw preprocessorError('#define requires a macro name', location);
            }
            if (definition[2].startsWith('(')) {
                throw preprocessorError('function-style macros are not supported', location);
            }
            context.macros.set(definition[1], definition[2].trimStart());
        }
        emit('', location);
        return;
    }

    if (name === 'undef') {
        if (active) {
            context.macros.delete(parseSingleIdentifier(body, location, '#undef requires a macro name'));
        }
        emit('', location);
        return;
    }

    if (name === 'include') {
        if (active) {
            const include = body.match(/^\s*"([^"]+)"\s*$/);
            if (!include) {
                throw preprocessorError('only quoted includes are supported', location);
            }
            emit('', location);
            processFile(path.resolve(path.dirname(location.file), include[1]), location);
            return;
        }
        emit('', location);
        return;
    }

    throw preprocessorError(`unsupported preprocessor directive '#${name}'`, location);
}

function parseDirective(line: string): { name: string; body: string } | undefined {
    const match = line.match(/^\s*#\s*([A-Za-z_]\w*)([\s\S]*)$/);
    return match ? { name: match[1], body: match[2] } : undefined;
}

function parseSingleIdentifier(body: string, location: CSourceLocation, message: string): string {
    const match = body.match(/^\s*([A-Za-z_]\w*)\s*$/);
    if (!match) {
        throw preprocessorError(message, location);
    }
    return match[1];
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

function preprocessorError(message: string, location: CSourceLocation): CPreprocessorError {
    return new CPreprocessorError(message, location.file, location.line, 1);
}
