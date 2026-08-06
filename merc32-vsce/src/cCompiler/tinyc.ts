export interface CompileOptions {
    dataBase?: number;
    dlbAddrWidth?: number;
    moduleName?: string;
    tempSlots?: number;
}

export interface CompileResult {
    assembly: string;
}

export class CompilerError extends Error {
    constructor(message: string, readonly line?: number, readonly column?: number) {
        super(line !== undefined && column !== undefined ? `${line}:${column}: ${message}` : message);
        this.name = 'CompilerError';
    }
}

type BaseType = 'char' | 'uchar' | 'short' | 'ushort' | 'int' | 'uint' | 'void';

interface CType {
    base: BaseType;
    pointerDepth: number;
    arrayLength?: number | null;
    volatile: boolean;
}

interface Token {
    kind: 'identifier' | 'number' | 'string' | 'keyword' | 'symbol' | 'eof';
    text: string;
    value?: number;
    bytes?: number[];
    line: number;
    column: number;
}

interface Program {
    globals: GlobalDecl[];
    functions: FunctionDecl[];
}

type Initializer = ExprInitializer | ListInitializer;

interface ExprInitializer {
    kind: 'expr-init';
    expr: Expr;
}

interface ListInitializer {
    kind: 'list-init';
    values: Expr[];
    line: number;
    column: number;
}

interface GlobalDecl {
    kind: 'global';
    type: CType;
    name: string;
    init?: Initializer;
}

interface FunctionDecl {
    kind: 'function';
    returnType: CType;
    name: string;
    params: ParamDecl[];
    body?: BlockStmt;
}

interface ParamDecl {
    type: CType;
    name: string;
}

type Statement =
    | BlockStmt
    | VarDeclStmt
    | ExprStmt
    | IfStmt
    | WhileStmt
    | ForStmt
    | ReturnStmt
    | BreakStmt
    | ContinueStmt
    | GotoStmt
    | LabelStmt
    | EmptyStmt;

interface BlockStmt {
    kind: 'block';
    statements: Statement[];
}

interface VarDeclStmt {
    kind: 'var';
    type: CType;
    name: string;
    init?: Initializer;
}

interface ExprStmt {
    kind: 'expr';
    expr: Expr;
}

interface IfStmt {
    kind: 'if';
    test: Expr;
    thenBranch: Statement;
    elseBranch?: Statement;
}

interface WhileStmt {
    kind: 'while';
    test: Expr;
    body: Statement;
}

interface ForStmt {
    kind: 'for';
    init?: VarDeclStmt | Expr;
    test?: Expr;
    step?: Expr;
    body: Statement;
}

interface ReturnStmt {
    kind: 'return';
    expr?: Expr;
}

interface BreakStmt {
    kind: 'break';
}

interface ContinueStmt {
    kind: 'continue';
}

interface GotoStmt {
    kind: 'goto';
    label: string;
}

interface LabelStmt {
    kind: 'label';
    label: string;
    statement: Statement;
}

interface EmptyStmt {
    kind: 'empty';
}

type Expr =
    | NumberExpr
    | StringExpr
    | VarExpr
    | AssignExpr
    | CompoundAssignExpr
    | UpdateExpr
    | ConditionalExpr
    | BinaryExpr
    | UnaryExpr
    | CallExpr
    | CastExpr
    | IndexExpr;

interface NumberExpr {
    kind: 'number';
    value: number;
}

interface StringExpr {
    kind: 'string';
    bytes: number[];
    line: number;
    column: number;
}

interface VarExpr {
    kind: 'varref';
    name: string;
}

interface AssignExpr {
    kind: 'assign';
    target: Expr;
    value: Expr;
}

interface CompoundAssignExpr {
    kind: 'compound-assign';
    target: Expr;
    op: string;
    value: Expr;
    line: number;
    column: number;
}

interface UpdateExpr {
    kind: 'update';
    target: Expr;
    delta: 1 | -1;
    prefix: boolean;
    line: number;
    column: number;
}

interface ConditionalExpr {
    kind: 'conditional';
    test: Expr;
    consequent: Expr;
    alternate: Expr;
    line: number;
    column: number;
}

interface BinaryExpr {
    kind: 'binary';
    op: string;
    left: Expr;
    right: Expr;
}

interface UnaryExpr {
    kind: 'unary';
    op: string;
    expr: Expr;
}

interface CallExpr {
    kind: 'call';
    name: string;
    args: Expr[];
}

interface IndexExpr {
    kind: 'index';
    target: Expr;
    index: Expr;
}

interface CastExpr {
    kind: 'cast';
    type: CType;
    expr: Expr;
    line: number;
    column: number;
}

const KEYWORDS = new Set([
    'char',
    'short',
    'int',
    'unsigned',
    'void',
    'volatile',
    'return',
    'if',
    'else',
    'while',
    'for',
    'break',
    'continue',
    'goto',
]);

const THREE_CHAR_SYMBOLS = new Set(['<<=', '>>=']);
const TWO_CHAR_SYMBOLS = new Set([
    '==', '!=', '<=', '>=', '&&', '||', '<<', '>>',
    '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
]);
const ONE_CHAR_SYMBOLS = new Set(['+', '-', '*', '/', '%', '&', '|', '^', '~', '!', '=', '<', '>', '?', ';', ',', '(', ')', '{', '}', '[', ']', ':']);
const COMPOUND_ASSIGNMENT_OPERATORS = new Map([
    ['+=', '+'],
    ['-=', '-'],
    ['*=', '*'],
    ['/=', '/'],
    ['%=', '%'],
    ['&=', '&'],
    ['|=', '|'],
    ['^=', '^'],
    ['<<=', '<<'],
    ['>>=', '>>'],
]);

class Lexer {
    private index = 0;
    private line = 1;
    private column = 1;

    constructor(private readonly source: string) {}

    tokenize(): Token[] {
        const tokens: Token[] = [];
        while (true) {
            const token = this.nextToken();
            tokens.push(token);
            if (token.kind === 'eof') {
                return tokens;
            }
        }
    }

    private nextToken(): Token {
        this.skipTrivia();
        const line = this.line;
        const column = this.column;
        const c = this.peek();

        if (c === '') {
            return { kind: 'eof', text: '', line, column };
        }

        if (/[A-Za-z_]/.test(c)) {
            const text = this.readWhile(/[A-Za-z0-9_]/);
            return { kind: KEYWORDS.has(text) ? 'keyword' : 'identifier', text, line, column };
        }

        if (/\d/.test(c)) {
            return this.readNumber(line, column);
        }

        if (c === "'") {
            return this.readCharacterLiteral(line, column);
        }

        if (c === '"') {
            return this.readStringLiteral(line, column);
        }

        const three = c + this.peek(1) + this.peek(2);
        if (THREE_CHAR_SYMBOLS.has(three)) {
            this.advance();
            this.advance();
            this.advance();
            return { kind: 'symbol', text: three, line, column };
        }

        const two = c + this.peek(1);
        if (TWO_CHAR_SYMBOLS.has(two)) {
            this.advance();
            this.advance();
            return { kind: 'symbol', text: two, line, column };
        }

        if (ONE_CHAR_SYMBOLS.has(c)) {
            this.advance();
            return { kind: 'symbol', text: c, line, column };
        }

        throw new CompilerError(`unexpected character '${c}'`, line, column);
    }

    private readNumber(line: number, column: number): Token {
        let text = '';
        if (this.peek() === '0' && /[xXbB]/.test(this.peek(1))) {
            text += this.advance();
            text += this.advance();
            const digitPattern = text[1].toLowerCase() === 'x' ? /[0-9A-Fa-f]/ : /[01]/;
            const digits = this.readWhile(digitPattern);
            if (!digits) {
                throw new CompilerError(`invalid numeric literal '${text}'`, line, column);
            }
            text += digits;
        } else {
            text = this.readWhile(/\d/);
        }

        let value: number;
        if (/^0x/i.test(text)) {
            value = Number.parseInt(text.slice(2), 16);
        } else if (/^0b/i.test(text)) {
            value = Number.parseInt(text.slice(2), 2);
        } else {
            value = Number.parseInt(text, 10);
        }
        if (!Number.isFinite(value)) {
            throw new CompilerError(`invalid numeric literal '${text}'`, line, column);
        }
        return { kind: 'number', text, value, line, column };
    }

    private readCharacterLiteral(line: number, column: number): Token {
        const start = this.index;
        this.advance();
        const bytes = this.readLiteralBytes("'", line, column);
        const text = this.source.slice(start, this.index);
        if (bytes.length === 0) {
            throw new CompilerError('empty character literal', line, column);
        }
        if (bytes.length !== 1) {
            throw new CompilerError('character literal must contain exactly one byte', line, column);
        }
        return { kind: 'number', text, value: bytes[0], line, column };
    }

    private readStringLiteral(line: number, column: number): Token {
        const start = this.index;
        this.advance();
        const bytes = this.readLiteralBytes('"', line, column);
        return { kind: 'string', text: this.source.slice(start, this.index), bytes, line, column };
    }

    private readLiteralBytes(terminator: "'" | '"', line: number, column: number): number[] {
        const bytes: number[] = [];
        const literalKind = terminator === "'" ? 'character' : 'string';
        while (true) {
            const c = this.peek();
            if (c === '' || c === '\n' || c === '\r') {
                throw new CompilerError(`unterminated ${literalKind} literal`, line, column);
            }
            if (c === terminator) {
                this.advance();
                return bytes;
            }
            if (c === '\\') {
                if (this.peek(1) === '' || this.peek(1) === '\n' || this.peek(1) === '\r') {
                    throw new CompilerError(`unterminated ${literalKind} literal`, line, column);
                }
                bytes.push(this.readEscapeByte(line, column));
                continue;
            }
            for (const byte of this.readRawLiteralBytes(terminator)) {
                bytes.push(byte);
            }
        }
    }

    private readEscapeByte(line: number, column: number): number {
        this.advance();
        const escape = this.advance();
        const simpleEscapes: Record<string, number> = {
            n: 0x0a,
            r: 0x0d,
            t: 0x09,
            '\\': 0x5c,
            "'": 0x27,
            '"': 0x22,
            a: 0x07,
            b: 0x08,
            f: 0x0c,
            v: 0x0b,
        };
        if (/[0-7]/.test(escape)) {
            let digits = escape;
            while (digits.length < 3 && /[0-7]/.test(this.peek())) {
                digits += this.advance();
            }
            const value = Number.parseInt(digits, 8);
            if (value > 0xff) {
                throw new CompilerError(`escape value \\${digits} exceeds one byte`, line, column);
            }
            return value;
        }

        if (escape in simpleEscapes) {
            return simpleEscapes[escape];
        }

        if (escape === 'x') {
            const digits = this.readWhile(/[0-9A-Fa-f]/);
            if (digits.length === 0) {
                throw new CompilerError('hexadecimal escape requires at least one digit', line, column);
            }
            const value = Number.parseInt(digits, 16);
            if (value > 0xff) {
                throw new CompilerError(`escape value 0x${digits.toUpperCase()} exceeds one byte`, line, column);
            }
            return value;
        }

        throw new CompilerError(`unknown escape '\\${escape}'`, line, column);
    }

    private readRawLiteralBytes(terminator: "'" | '"'): number[] {
        const start = this.index;
        while (true) {
            const c = this.peek();
            if (c === '' || c === '\n' || c === '\r' || c === '\\' || c === terminator) {
                break;
            }
            this.advance();
        }
        return Array.from(Buffer.from(this.source.slice(start, this.index), 'utf8'));
    }

    private skipTrivia(): void {
        while (true) {
            const c = this.peek();
            if (c === '') {
                return;
            }
            if (/\s/.test(c)) {
                this.advance();
                continue;
            }
            if (c === '/' && this.peek(1) === '/') {
                while (this.peek() !== '' && this.peek() !== '\n') {
                    this.advance();
                }
                continue;
            }
            if (c === '/' && this.peek(1) === '*') {
                this.advance();
                this.advance();
                while (this.peek() !== '') {
                    if (this.peek() === '*' && this.peek(1) === '/') {
                        this.advance();
                        this.advance();
                        break;
                    }
                    this.advance();
                }
                continue;
            }
            return;
        }
    }

    private readWhile(pattern: RegExp): string {
        let text = '';
        while (this.peek() !== '' && pattern.test(this.peek())) {
            text += this.advance();
        }
        return text;
    }

    private peek(offset = 0): string {
        return this.source[this.index + offset] || '';
    }

    private advance(): string {
        const c = this.source[this.index++] || '';
        if (c === '\n') {
            this.line++;
            this.column = 1;
        } else {
            this.column++;
        }
        return c;
    }
}

class Parser {
    private index = 0;

    constructor(private readonly tokens: Token[]) {}

    parseProgram(): Program {
        const globals: GlobalDecl[] = [];
        const functions: FunctionDecl[] = [];

        while (!this.is('')) {
            const type = this.parseType();
            if (type.pointerDepth > 0 && type.base === 'void') {
                throw this.error('void pointers are not supported yet');
            }
            const name = this.expectIdentifier();
            const declaratorType = this.parseDeclaratorSuffix(type);
            if (this.match('(')) {
                const params = this.parseParams();
                if (this.match(';')) {
                    if (isArrayType(declaratorType)) {
                        throw this.error('function cannot return an array');
                    }
                    functions.push({ kind: 'function', returnType: declaratorType, name, params });
                } else {
                    if (isArrayType(declaratorType)) {
                        throw this.error('function cannot return an array');
                    }
                    functions.push({ kind: 'function', returnType: declaratorType, name, params, body: this.parseBlock() });
                }
            } else {
                let init: Initializer | undefined;
                if (this.match('=')) {
                    init = this.parseInitializer();
                }
                const declaredType = this.finalizeDeclaratorType(declaratorType, init);
                this.expect(';');
                globals.push({ kind: 'global', type: declaredType, name, init });
            }
        }

        return { globals, functions };
    }

    private parseParams(): ParamDecl[] {
        if (this.match(')')) {
            return [];
        }
        if (this.isKeyword('void') && this.peek(1).text === ')') {
            this.advance();
            this.expect(')');
            return [];
        }

        const params: ParamDecl[] = [];
        do {
            const type = this.parseType();
            if (isVoidType(type)) {
                throw this.error('parameter type cannot be void');
            }
            const name = this.expectIdentifier();
            const declaredType = this.parseDeclaratorSuffix(type);
            if (isArrayType(declaredType)) {
                throw this.error('array parameters are not supported yet; use a pointer parameter');
            }
            params.push({ type: declaredType, name });
        } while (this.match(','));
        this.expect(')');
        return params;
    }

    private parseBlock(): BlockStmt {
        this.expect('{');
        const statements: Statement[] = [];
        while (!this.match('}')) {
            if (this.is('')) {
                throw this.error('expected } before end of file');
            }
            statements.push(this.parseStatement());
        }
        return { kind: 'block', statements };
    }

    private parseStatement(): Statement {
        if (this.is('{')) {
            return this.parseBlock();
        }
        if (this.match(';')) {
            return { kind: 'empty' };
        }
        if (this.isTypeStart()) {
            const type = this.parseType();
            if (isVoidType(type)) {
                throw this.error('local variable cannot have void type');
            }
            return this.parseVarDeclAfterType(type, true);
        }
        if (this.matchKeyword('if')) {
            this.expect('(');
            const test = this.parseExpression();
            this.expect(')');
            const thenBranch = this.parseStatement();
            const elseBranch = this.matchKeyword('else') ? this.parseStatement() : undefined;
            return { kind: 'if', test, thenBranch, elseBranch };
        }
        if (this.matchKeyword('while')) {
            this.expect('(');
            const test = this.parseExpression();
            this.expect(')');
            return { kind: 'while', test, body: this.parseStatement() };
        }
        if (this.matchKeyword('for')) {
            this.expect('(');
            let init: VarDeclStmt | Expr | undefined;
            if (this.match(';')) {
                init = undefined;
            } else if (this.isTypeStart()) {
                const type = this.parseType();
                if (isVoidType(type)) {
                    throw this.error('local variable cannot have void type');
                }
                init = this.parseVarDeclAfterType(type, true);
            } else {
                init = this.parseExpression();
                this.expect(';');
            }

            const test = this.match(';') ? undefined : this.parseExpression();
            if (test) {
                this.expect(';');
            }
            const step = this.match(')') ? undefined : this.parseExpression();
            if (step) {
                this.expect(')');
            }
            return { kind: 'for', init, test, step, body: this.parseStatement() };
        }
        if (this.matchKeyword('return')) {
            const expr = this.match(';') ? undefined : this.parseExpression();
            if (expr) {
                this.expect(';');
            }
            return { kind: 'return', expr };
        }
        if (this.matchKeyword('break')) {
            this.expect(';');
            return { kind: 'break' };
        }
        if (this.matchKeyword('continue')) {
            this.expect(';');
            return { kind: 'continue' };
        }
        if (this.matchKeyword('goto')) {
            const label = this.expectIdentifier();
            this.expect(';');
            return { kind: 'goto', label };
        }
        if (this.current().kind === 'identifier' && this.peek(1).text === ':') {
            const label = this.advance().text;
            this.expect(':');
            return { kind: 'label', label, statement: this.parseStatement() };
        }

        const expr = this.parseExpression();
        this.expect(';');
        return { kind: 'expr', expr };
    }

    private parseVarDeclAfterType(type: CType, expectSemicolon: boolean): VarDeclStmt {
        const name = this.expectIdentifier();
        const declaratorType = this.parseDeclaratorSuffix(type);
        const init = this.match('=') ? this.parseInitializer() : undefined;
        const declaredType = this.finalizeDeclaratorType(declaratorType, init);
        if (expectSemicolon) {
            this.expect(';');
        }
        return { kind: 'var', type: declaredType, name, init };
    }

    private parseDeclaratorSuffix(type: CType): CType {
        if (!this.match('[')) {
            return type;
        }
        if (type.pointerDepth > 0) {
            throw this.error('arrays of pointers are not supported yet');
        }
        if (isVoidType(type)) {
            throw this.error('array element type cannot be void');
        }

        let arrayLength: number | null;
        if (this.match(']')) {
            arrayLength = null;
        } else {
            const sizeToken = this.current();
            if (sizeToken.kind !== 'number' || sizeToken.value === undefined || sizeToken.value <= 0) {
                throw this.error('array size must be a positive numeric constant');
            }
            this.advance();
            this.expect(']');
            arrayLength = sizeToken.value;
        }
        if (this.is('[')) {
            throw this.error('multi-dimensional arrays are not supported');
        }
        return { ...type, arrayLength };
    }

    private parseInitializer(): Initializer {
        if (!this.is('{')) {
            return { kind: 'expr-init', expr: this.parseExpression() };
        }

        const openBrace = this.advance();
        const values: Expr[] = [];
        if (!this.match('}')) {
            while (true) {
                if (this.is('{')) {
                    throw this.error('nested initializers are not supported');
                }
                values.push(this.parseExpression());
                if (this.match('}')) {
                    break;
                }
                this.expect(',');
                if (this.match('}')) {
                    break;
                }
            }
        }
        return {
            kind: 'list-init',
            values,
            line: openBrace.line,
            column: openBrace.column,
        };
    }

    private finalizeDeclaratorType(type: CType, init?: Initializer): CType {
        if (!isArrayType(type)) {
            if (init?.kind === 'list-init') {
                throw new CompilerError('initializer list requires an array', init.line, init.column);
            }
            if (init?.kind === 'expr-init' && init.expr.kind === 'string' && type.pointerDepth === 0) {
                throw new CompilerError(
                    'string initializer requires an array or pointer',
                    init.expr.line,
                    init.expr.column,
                );
            }
            return type;
        }

        if (!init) {
            if (type.arrayLength === null) {
                throw this.error('incomplete array requires an initializer');
            }
            return type;
        }

        if (init.kind === 'list-init') {
            if (type.arrayLength === null) {
                if (init.values.length === 0) {
                    throw new CompilerError(
                        'cannot infer array length from empty initializer',
                        init.line,
                        init.column,
                    );
                }
                return { ...type, arrayLength: init.values.length };
            }
            if (init.values.length > type.arrayLength) {
                throw new CompilerError(
                    'too many array initializer elements',
                    init.line,
                    init.column,
                );
            }
            return type;
        }

        if (init.expr.kind !== 'string') {
            throw this.error('array initializer must be a list or string literal');
        }
        if (type.pointerDepth !== 0 || (type.base !== 'char' && type.base !== 'uchar')) {
            throw new CompilerError(
                'string initializer requires a character array',
                init.expr.line,
                init.expr.column,
            );
        }

        const requiredLength = init.expr.bytes.length + 1;
        if (type.arrayLength === null) {
            return { ...type, arrayLength: requiredLength };
        }
        if (requiredLength > type.arrayLength) {
            throw new CompilerError(
                'string initializer does not fit in character array',
                init.expr.line,
                init.expr.column,
            );
        }
        return type;
    }

    private parseExpression(): Expr {
        return this.parseAssignment();
    }

    private parseAssignment(): Expr {
        const left = this.parseConditional();
        if (this.match('=')) {
            if (!this.isAssignable(left)) {
                throw this.error('left side of assignment must be a variable or dereference');
            }
            return { kind: 'assign', target: left, value: this.parseAssignment() };
        }
        const operator = COMPOUND_ASSIGNMENT_OPERATORS.get(this.current().text);
        if (operator) {
            const token = this.advance();
            if (!this.isAssignable(left)) {
                throw new CompilerError(
                    'left side of compound assignment must be a modifiable lvalue',
                    token.line,
                    token.column,
                );
            }
            return {
                kind: 'compound-assign',
                target: left,
                op: operator,
                value: this.parseAssignment(),
                line: token.line,
                column: token.column,
            };
        }
        return left;
    }

    private parseConditional(): Expr {
        const test = this.parseLogicalOr();
        if (!this.is('?')) {
            return test;
        }

        const token = this.advance();
        const consequent = this.parseExpression();
        this.expect(':');
        return {
            kind: 'conditional',
            test,
            consequent,
            alternate: this.parseConditional(),
            line: token.line,
            column: token.column,
        };
    }

    private isAssignable(expr: Expr): boolean {
        return expr.kind === 'varref' || expr.kind === 'index' || (expr.kind === 'unary' && expr.op === '*');
    }

    private parseLogicalOr(): Expr {
        return this.parseBinary(() => this.parseLogicalAnd(), ['||']);
    }

    private parseLogicalAnd(): Expr {
        return this.parseBinary(() => this.parseBitwiseOr(), ['&&']);
    }

    private parseBitwiseOr(): Expr {
        return this.parseBinary(() => this.parseBitwiseXor(), ['|']);
    }

    private parseBitwiseXor(): Expr {
        return this.parseBinary(() => this.parseBitwiseAnd(), ['^']);
    }

    private parseBitwiseAnd(): Expr {
        return this.parseBinary(() => this.parseEquality(), ['&']);
    }

    private parseEquality(): Expr {
        return this.parseBinary(() => this.parseRelational(), ['==', '!=']);
    }

    private parseRelational(): Expr {
        return this.parseBinary(() => this.parseShift(), ['<', '<=', '>', '>=']);
    }

    private parseShift(): Expr {
        return this.parseBinary(() => this.parseAdditive(), ['<<', '>>']);
    }

    private parseAdditive(): Expr {
        return this.parseBinary(() => this.parseMultiplicative(), ['+', '-']);
    }

    private parseMultiplicative(): Expr {
        return this.parseBinary(() => this.parseUnary(), ['*', '/', '%']);
    }

    private parseBinary(next: () => Expr, ops: string[]): Expr {
        let expr = next();
        while (ops.includes(this.current().text)) {
            const op = this.advance().text;
            expr = { kind: 'binary', op, left: expr, right: next() };
        }
        return expr;
    }

    private parseUnary(): Expr {
        if (this.current().text === '++' || this.current().text === '--') {
            const token = this.advance();
            const target = this.parseUnary();
            if (!this.isAssignable(target)) {
                throw new CompilerError(
                    `operand of '${token.text}' must be a modifiable lvalue`,
                    token.line,
                    token.column,
                );
            }
            return {
                kind: 'update',
                target,
                delta: token.text === '++' ? 1 : -1,
                prefix: true,
                line: token.line,
                column: token.column,
            };
        }
        if (['+', '-', '!', '~', '*', '&'].includes(this.current().text)) {
            const op = this.advance().text;
            const expr = this.parseUnary();
            return op === '+' ? expr : { kind: 'unary', op, expr };
        }
        return this.parsePostfix();
    }

    private parsePostfix(): Expr {
        let expr = this.parsePrimary();
        while (this.match('[')) {
            const index = this.parseExpression();
            this.expect(']');
            expr = { kind: 'index', target: expr, index };
        }
        if (this.current().text === '++' || this.current().text === '--') {
            const token = this.advance();
            if (!this.isAssignable(expr)) {
                throw new CompilerError(
                    `operand of '${token.text}' must be a modifiable lvalue`,
                    token.line,
                    token.column,
                );
            }
            expr = {
                kind: 'update',
                target: expr,
                delta: token.text === '++' ? 1 : -1,
                prefix: false,
                line: token.line,
                column: token.column,
            };
        }
        return expr;
    }

    private parsePrimary(): Expr {
        if (this.is('(')) {
            const openParen = this.advance();
            if (this.isTypeStart()) {
                const type = this.parseType();
                this.expect(')');
                return {
                    kind: 'cast',
                    type,
                    expr: this.parseUnary(),
                    line: openParen.line,
                    column: openParen.column,
                };
            }
            const expr = this.parseExpression();
            this.expect(')');
            return expr;
        }
        if (this.current().kind === 'number') {
            const token = this.advance();
            return { kind: 'number', value: token.value || 0 };
        }
        if (this.current().kind === 'string') {
            const firstToken = this.current();
            const bytes: number[] = [];
            while (this.current().kind === 'string') {
                for (const byte of this.advance().bytes || []) {
                    bytes.push(byte);
                }
            }
            return {
                kind: 'string',
                bytes,
                line: firstToken.line,
                column: firstToken.column,
            };
        }
        if (this.current().kind === 'identifier') {
            const name = this.advance().text;
            if (this.match('(')) {
                const args: Expr[] = [];
                if (!this.match(')')) {
                    do {
                        args.push(this.parseExpression());
                    } while (this.match(','));
                    this.expect(')');
                }
                return { kind: 'call', name, args };
            }
            return { kind: 'varref', name };
        }
        throw this.error(`unexpected token '${this.current().text}'`);
    }

    private parseType(): CType {
        let volatile = false;
        while (this.matchKeyword('volatile')) {
            volatile = true;
        }

        let base: BaseType;
        if (this.matchKeyword('unsigned')) {
            if (this.matchKeyword('char')) {
                base = 'uchar';
            } else if (this.matchKeyword('short')) {
                this.matchKeyword('int');
                base = 'ushort';
            } else {
                this.matchKeyword('int');
                base = 'uint';
            }
        } else if (this.matchKeyword('char')) {
            base = 'char';
        } else if (this.matchKeyword('short')) {
            this.matchKeyword('int');
            base = 'short';
        } else if (this.matchKeyword('int')) {
            base = 'int';
        } else if (this.matchKeyword('void')) {
            base = 'void';
        } else {
            throw this.error('expected type');
        }

        while (this.matchKeyword('volatile')) {
            volatile = true;
        }

        let pointerDepth = 0;
        while (this.match('*')) {
            pointerDepth++;
            while (this.matchKeyword('volatile')) {
                volatile = true;
            }
        }

        return { base, pointerDepth, volatile };
    }

    private isTypeStart(): boolean {
        return this.isKeyword('char') || this.isKeyword('short') || this.isKeyword('int')
            || this.isKeyword('unsigned') || this.isKeyword('void') || this.isKeyword('volatile');
    }

    private expectIdentifier(): string {
        const token = this.current();
        if (token.kind !== 'identifier') {
            throw this.error('expected identifier');
        }
        this.advance();
        return token.text;
    }

    private expect(text: string): void {
        if (!this.match(text)) {
            throw this.error(`expected '${text}'`);
        }
    }

    private expectKeyword(text: string): void {
        if (!this.matchKeyword(text)) {
            throw this.error(`expected '${text}'`);
        }
    }

    private match(text: string): boolean {
        if (this.is(text)) {
            this.advance();
            return true;
        }
        return false;
    }

    private matchKeyword(text: string): boolean {
        if (this.isKeyword(text)) {
            this.advance();
            return true;
        }
        return false;
    }

    private is(text: string): boolean {
        return this.current().text === text;
    }

    private isKeyword(text: string): boolean {
        const token = this.current();
        return token.kind === 'keyword' && token.text === text;
    }

    private current(): Token {
        return this.tokens[this.index];
    }

    private peek(offset: number): Token {
        return this.tokens[this.index + offset] || this.tokens[this.tokens.length - 1];
    }

    private advance(): Token {
        return this.tokens[this.index++];
    }

    private error(message: string): CompilerError {
        const token = this.current();
        return new CompilerError(message, token.line, token.column);
    }
}

interface Slot {
    type: CType;
    offset?: number;
    globalAddress?: number;
    sizeBytes: number;
}

interface StaticString {
    bytes: number[];
    address: number;
}

type NormalizedArrayInitializer = ExprArrayInitializer | ByteArrayInitializer;

interface ExprArrayInitializer {
    kind: 'expr-elements';
    values: Expr[];
    zeroFill: number;
}

interface ByteArrayInitializer {
    kind: 'byte-elements';
    values: number[];
    zeroFill: number;
}

interface FunctionLayout {
    slots: Map<string, Slot>;
    frameSize: number;
    tempBase: number;
    tempSlots: number;
    maxCallArgs: number;
}

interface FunctionContext {
    fn: FunctionDecl;
    layout: FunctionLayout;
    returnLabel: string;
    breakLabels: string[];
    continueLabels: string[];
    tempDepth: number;
    labelId: number;
}

const ABI_RETURN_REG = 'r4';
const ABI_ARG_REGS = ['r4', 'r5', 'r6', 'r7'];
const IRQ_HANDLER_NAME = '__irq_handler';
const IRQ_VECTOR_ADDRESS = 4;
const IRQ_CONTEXT_REGS = ['r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11'];
// At two instructions per element, three inline zero stores cost no more than the loop path.
const MAX_INLINE_LOCAL_ARRAY_ZERO_STORES = 3;

class CodeGenerator {
    private readonly lines: string[] = [];
    private readonly globals = new Map<string, Slot>();
    private readonly staticStrings = new Map<string, StaticString>();
    private readonly functionMap = new Map<string, FunctionDecl>();
    private readonly occupiedAssemblyLabels = new Set<string>();
    private readonly dataBase: number;
    private readonly dataLimit: number;
    private readonly moduleName: string;
    private readonly tempSlots: number;
    private nextGlobalAddress: number;
    private internalLabelId = 0;
    private current?: FunctionContext;
    private interruptHandler?: FunctionDecl;

    constructor(private readonly program: Program, options: CompileOptions) {
        const dataBase = options.dataBase ?? 0x0080_0000;
        if (!Number.isSafeInteger(dataBase)) {
            throw new CompilerError('dataBase must be a finite safe integer');
        }
        if (dataBase < 0 || dataBase > 0xffff_ffff) {
            throw new CompilerError('dataBase must be between 0 and 0xFFFFFFFF');
        }

        const dlbAddrWidth = options.dlbAddrWidth ?? 16;
        if (!Number.isSafeInteger(dlbAddrWidth) || dlbAddrWidth < 0) {
            throw new CompilerError('dlbAddrWidth must be a non-negative safe integer');
        }

        const dataLimit = dataBase + 2 ** (dlbAddrWidth + 2);
        if (!Number.isSafeInteger(dataLimit) || dataLimit > 0x1_0000_0000) {
            throw new CompilerError('DLB address range exceeds 32-bit address space');
        }

        this.dataBase = dataBase;
        this.dataLimit = dataLimit;
        this.moduleName = sanitizeIdentifier(options.moduleName || 'merc32_c_program');
        this.tempSlots = options.tempSlots ?? 32;
        this.nextGlobalAddress = this.dataBase;
    }

    generate(): string {
        this.indexProgram();
        const startLabel = this.allocateInternalLabel('__start');
        const haltLabel = this.allocateInternalLabel('__halt');
        const interruptVectorLabel = this.interruptHandler
            ? this.allocateInternalLabel('__irq_vector')
            : undefined;

        this.emit(`.prog ${this.moduleName}`);
        this.emit(`.entry ${startLabel}`);
        this.emit('');
        if (this.interruptHandler && interruptVectorLabel) {
            this.emitInterruptVector(interruptVectorLabel);
            this.emit('');
        }
        this.emit(`${startLabel}:`);
        this.loadImm('r13', this.dataLimit === 0x1_0000_0000 ? 0 : this.dataLimit);
        this.emitGlobalInitializers();
        if (this.interruptHandler) {
            this.loadImm('r2', IRQ_VECTOR_ADDRESS);
        }
        this.emit('jmp main, r14');
        this.emit(`${haltLabel}:`);
        this.emit(`jmp ${haltLabel}`);
        this.emit('');

        for (const fn of this.program.functions) {
            if (fn.body) {
                this.emitFunction(fn);
                this.emit('');
            }
        }

        return this.lines.join('\n') + '\n';
    }

    private indexProgram(): void {
        this.reserveUserAssemblyLabels();
        for (const global of this.program.globals) {
            if (this.globals.has(global.name)) {
                throw new CompilerError(`duplicate global '${global.name}'`);
            }
            if (isVoidType(global.type)) {
                throw new CompilerError(`global '${global.name}' cannot have void type`);
            }
            this.nextGlobalAddress = alignTo(this.nextGlobalAddress, typeAlignmentBytes(global.type));
            this.globals.set(global.name, {
                type: global.type,
                globalAddress: this.nextGlobalAddress,
                sizeBytes: typeSizeBytes(global.type),
            });
            this.nextGlobalAddress += typeSizeBytes(global.type);
        }

        this.ensureStaticDataFits();
        this.collectStaticStrings();

        for (const fn of this.program.functions) {
            const previous = this.functionMap.get(fn.name);
            if (previous?.body && fn.body) {
                throw new CompilerError(`duplicate function '${fn.name}'`);
            }
            if (!previous || fn.body) {
                this.functionMap.set(fn.name, fn);
            }
        }

        if (!this.functionMap.get('main')?.body) {
            throw new CompilerError("entry function 'main' is required");
        }

        const interruptHandler = this.functionMap.get(IRQ_HANDLER_NAME);
        if (interruptHandler) {
            if (!isVoidType(interruptHandler.returnType)) {
                throw new CompilerError(`${IRQ_HANDLER_NAME} must return void`);
            }
            if (interruptHandler.params.length !== 0) {
                throw new CompilerError(`${IRQ_HANDLER_NAME} must not have parameters`);
            }
            if (!interruptHandler.body) {
                throw new CompilerError(`${IRQ_HANDLER_NAME} must have a definition`);
            }
            this.interruptHandler = interruptHandler;
        }
    }

    private emitGlobalInitializers(): void {
        for (const global of this.program.globals) {
            const slot = this.globals.get(global.name);
            if (slot?.globalAddress === undefined) {
                throw new CompilerError(`internal error: missing global '${global.name}'`);
            }
            if (isArrayType(global.type)) {
                this.emitGlobalArrayInitializer(slot, global.type, global.init);
                continue;
            }
            const value = global.init ? this.evalGlobalConstant(this.exprInitializer(global.init)) : 0;
            this.loadImm('r7', value);
            this.loadImm('r8', slot.globalAddress);
            this.emitStoreToAddress('r8', 'r7', global.type);
        }

        for (const entry of this.staticStrings.values()) {
            for (let offset = 0; offset <= entry.bytes.length; offset++) {
                this.loadImm('r7', entry.bytes[offset] ?? 0);
                this.loadImm('r8', entry.address + offset);
                this.emit('sb [r8], r7');
            }
        }
    }

    private reserveUserAssemblyLabels(): void {
        for (const fn of this.program.functions) {
            this.occupiedAssemblyLabels.add(fn.name);
            if (fn.body) {
                this.reserveUserLabelsInStatement(fn.name, fn.body);
            }
        }
    }

    private reserveUserLabelsInStatement(functionName: string, stmt: Statement): void {
        switch (stmt.kind) {
            case 'block':
                stmt.statements.forEach((inner) => this.reserveUserLabelsInStatement(functionName, inner));
                return;
            case 'if':
                this.reserveUserLabelsInStatement(functionName, stmt.thenBranch);
                if (stmt.elseBranch) this.reserveUserLabelsInStatement(functionName, stmt.elseBranch);
                return;
            case 'while':
            case 'for':
                this.reserveUserLabelsInStatement(functionName, stmt.body);
                return;
            case 'label':
                this.occupiedAssemblyLabels.add(`__${functionName}_${stmt.label}`);
                this.reserveUserLabelsInStatement(functionName, stmt.statement);
                return;
            case 'var':
            case 'expr':
            case 'return':
            case 'break':
            case 'continue':
            case 'goto':
            case 'empty':
                return;
        }
    }

    private emitGlobalArrayInitializer(slot: Slot, type: CType, init?: Initializer): void {
        if (slot.globalAddress === undefined) {
            throw new CompilerError('internal error: global array has no address');
        }
        this.validateArrayListInitializer(type, init);
        const normalized = normalizeArrayInitializer(type, init);
        const elementType = arrayElementType(type);
        const elementSize = typeSizeBytes(elementType);
        let index = 0;

        if (normalized.kind === 'expr-elements') {
            for (const expr of normalized.values) {
                this.loadImm('r7', convertConstant(this.evalGlobalConstant(expr), elementType));
                this.loadImm('r8', slot.globalAddress + index * elementSize);
                this.emitStoreToAddress('r8', 'r7', elementType);
                index++;
            }
        } else {
            for (const value of normalized.values) {
                this.loadImm('r7', value);
                this.loadImm('r8', slot.globalAddress + index * elementSize);
                this.emitStoreToAddress('r8', 'r7', elementType);
                index++;
            }
        }

        for (let count = 0; count < normalized.zeroFill; count++, index++) {
            this.loadImm('r7', 0);
            this.loadImm('r8', slot.globalAddress + index * elementSize);
            this.emitStoreToAddress('r8', 'r7', elementType);
        }
    }

    private exprInitializer(init: Initializer): Expr {
        if (init.kind !== 'expr-init') {
            throw new CompilerError('internal error: expected expression initializer');
        }
        return init.expr;
    }

    private validateArrayListInitializer(type: CType, init?: Initializer): void {
        if (init?.kind !== 'list-init') {
            return;
        }
        const elementType = arrayElementType(type);
        if (!isIntegerType(elementType)) {
            throw new CompilerError(
                'initializer list requires a non-pointer integer array',
                init.line,
                init.column,
            );
        }
        for (const value of init.values) {
            const valueType = this.exprType(value);
            if (isVoidType(valueType)) {
                throw new CompilerError(
                    'array initializer element cannot have void type',
                    init.line,
                    init.column,
                );
            }
            if (!isIntegerType(valueType)) {
                throw new CompilerError(
                    'array initializer element cannot have pointer type',
                    init.line,
                    init.column,
                );
            }
        }
    }

    private evalGlobalConstant(expr: Expr): number {
        this.validateConstantExpression(expr);
        this.requireExpressionValue(expr, this.exprType(expr), true);
        return this.evalConstant(expr);
    }

    private requireExpressionValue(expr: Expr, type: CType, valueRequired: boolean): void {
        if (!valueRequired || !isVoidType(type)) {
            return;
        }
        if (expr.kind === 'conditional') {
            throw new CompilerError(
                'void conditional expression cannot be used where a value is required',
                expr.line,
                expr.column,
            );
        }
        if (expr.kind === 'cast') {
            throw new CompilerError(
                'void expression cannot be used where a value is required',
                expr.line,
                expr.column,
            );
        }
        throw new CompilerError('void expression cannot be used where a value is required');
    }

    private validateConstantExpression(expr: Expr, valueRequired = true): void {
        switch (expr.kind) {
            case 'number':
            case 'string':
                break;
            case 'cast':
                this.validateConstantExpression(expr.expr, !isVoidType(expr.type));
                break;
            case 'unary': {
                if (!['-', '~', '!'].includes(expr.op)) {
                    throw new CompilerError('global initializer must be a constant expression');
                }
                this.validateUnaryOperand(expr);
                this.validateConstantExpression(expr.expr);
                break;
            }
            case 'binary':
                this.validateBinaryOperands(expr);
                this.validateConstantExpression(expr.left);
                this.validateConstantExpression(expr.right);
                break;
            case 'conditional':
                this.validateConstantExpression(expr.test);
                this.validateConstantExpression(expr.consequent, false);
                this.validateConstantExpression(expr.alternate, false);
                this.conditionalResultType(expr);
                break;
            case 'varref':
            case 'assign':
            case 'compound-assign':
            case 'update':
            case 'call':
            case 'index':
                throw new CompilerError('global initializer must be a constant expression');
        }
        this.requireExpressionValue(expr, this.exprType(expr), valueRequired);
    }

    private validateUnaryOperand(expr: UnaryExpr): void {
        const operandType = this.exprType(expr.expr);
        if (expr.expr.kind === 'conditional') {
            this.requireExpressionValue(expr.expr, operandType, true);
        }
        if (expr.op === '!') {
            if (isScalarType(operandType)) {
                return;
            }
            throw new CompilerError("operator '!' requires a scalar operand");
        }
        if (isIntegerType(operandType)) {
            return;
        }
        if (operandType.pointerDepth > 0) {
            throw new CompilerError(`operator '${expr.op}' does not accept pointer operands`);
        }
        throw new CompilerError(`operator '${expr.op}' requires an integer operand`);
    }

    private validateBinaryOperands(expr: BinaryExpr): void {
        const leftType = this.exprType(expr.left);
        const rightType = this.exprType(expr.right);
        if (expr.left.kind === 'conditional') {
            this.requireExpressionValue(expr.left, leftType, true);
        }
        if (expr.right.kind === 'conditional') {
            this.requireExpressionValue(expr.right, rightType, true);
        }
        const leftIsPointer = leftType.pointerDepth > 0;
        const rightIsPointer = rightType.pointerDepth > 0;
        const bothInteger = isIntegerType(leftType) && isIntegerType(rightType);

        if (expr.op === '&&' || expr.op === '||') {
            if (isScalarType(leftType) && isScalarType(rightType)) {
                return;
            }
            throw new CompilerError(`operator '${expr.op}' requires scalar operands`);
        }

        if (expr.op === '==' || expr.op === '!=') {
            if (bothInteger || (leftIsPointer && rightIsPointer)) {
                return;
            }
            if (leftIsPointer !== rightIsPointer) {
                const integerExpr = leftIsPointer ? expr.right : expr.left;
                if (this.isIntegerConstantZero(integerExpr)) {
                    return;
                }
            }
            throw new CompilerError(`operator '${expr.op}' requires compatible scalar operands`);
        }

        if (['<', '<=', '>', '>='].includes(expr.op)) {
            if (bothInteger || (leftIsPointer && rightIsPointer)) {
                return;
            }
            throw new CompilerError(`operator '${expr.op}' requires compatible scalar operands`);
        }

        if (expr.op === '+') {
            if (bothInteger || (leftIsPointer !== rightIsPointer
                && isIntegerType(leftIsPointer ? rightType : leftType))) {
                return;
            }
            if (leftIsPointer && rightIsPointer) {
                throw new CompilerError("operator '+' cannot add two pointers");
            }
            throw new CompilerError("operator '+' requires integer operands or one pointer and one integer");
        }
        if (expr.op === '-') {
            if (bothInteger || (leftIsPointer && isIntegerType(rightType))) {
                return;
            }
            if (leftIsPointer && rightIsPointer) {
                this.pointerDifferenceElementSize(leftType, rightType);
                return;
            }
            throw new CompilerError("operator '-' requires a pointer left operand and pointer or integer right operand");
        }

        if (['*', '/', '%', '&', '|', '^', '<<', '>>'].includes(expr.op)) {
            if (bothInteger) {
                return;
            }
            if (leftIsPointer || rightIsPointer) {
                throw new CompilerError(`operator '${expr.op}' does not accept pointer operands`);
            }
            throw new CompilerError(`operator '${expr.op}' requires integer operands`);
        }

        throw new CompilerError(`unsupported binary operator '${expr.op}'`);
    }

    private evalConstant(expr: Expr): number {
        switch (expr.kind) {
            case 'number':
                return expr.value;
            case 'string':
                return this.staticStringAddress(expr);
            case 'unary': {
                this.validateUnaryOperand(expr);
                const value = this.evalConstant(expr.expr);
                if (expr.op === '-') return -value;
                if (expr.op === '~') return ~value;
                if (expr.op === '!') return value ? 0 : 1;
                if (expr.op === '+') return value;
                break;
            }
            case 'cast':
                return convertConstant(this.evalConstant(expr.expr), expr.type);
            case 'conditional': {
                const resultType = this.conditionalResultType(expr);
                const selected = this.evalConstant(expr.test) ? expr.consequent : expr.alternate;
                return convertConstant(this.evalConstant(selected), resultType);
            }
            case 'binary': {
                this.validateBinaryOperands(expr);
                const left = this.evalConstant(expr.left);
                const right = this.evalConstant(expr.right);
                const leftType = this.exprType(expr.left);
                const rightType = this.exprType(expr.right);
                switch (expr.op) {
                    case '+': return this.evalConstantAddition(left, right, leftType, rightType);
                    case '-': return this.evalConstantSubtraction(left, right, leftType, rightType);
                    case '*': return Math.imul(left, right);
                    case '/':
                        if (right === 0) throw new CompilerError('division by zero in global initializer');
                        return Math.trunc(left / right);
                    case '%':
                        if (right === 0) throw new CompilerError('division by zero in global initializer');
                        return left % right;
                    case '&': return left & right;
                    case '|': return left | right;
                    case '^': return left ^ right;
                    case '<<': return left << right;
                    case '>>': return left >> right;
                    case '==': return left === right ? 1 : 0;
                    case '!=': return left !== right ? 1 : 0;
                    case '<': return left < right ? 1 : 0;
                    case '<=': return left <= right ? 1 : 0;
                    case '>': return left > right ? 1 : 0;
                    case '>=': return left >= right ? 1 : 0;
                }
                break;
            }
            case 'compound-assign':
            case 'update':
                break;
        }
        throw new CompilerError('global initializer must be a constant expression');
    }

    private evalConstantAddition(left: number, right: number, leftType: CType, rightType: CType): number {
        const leftIsPointer = leftType.pointerDepth > 0;
        const rightIsPointer = rightType.pointerDepth > 0;
        if (leftIsPointer && rightIsPointer) {
            throw new CompilerError("operator '+' cannot add two pointers");
        }
        if (leftIsPointer) {
            return left + right * typeSizeBytes(derefType(leftType));
        }
        if (rightIsPointer) {
            return left * typeSizeBytes(derefType(rightType)) + right;
        }
        return left + right;
    }

    private evalConstantSubtraction(left: number, right: number, leftType: CType, rightType: CType): number {
        const leftIsPointer = leftType.pointerDepth > 0;
        const rightIsPointer = rightType.pointerDepth > 0;
        if (leftIsPointer && rightIsPointer) {
            const leftSize = this.pointerDifferenceElementSize(leftType, rightType);
            const difference = left - right;
            if (leftSize === 2) return difference >>> 1;
            if (leftSize === 4) return difference >>> 2;
            return difference;
        }
        if (leftIsPointer) {
            return left - right * typeSizeBytes(derefType(leftType));
        }
        return left - right;
    }

    private collectStaticStrings(): void {
        for (const global of this.program.globals) {
            if (global.init) {
                this.collectStaticStringsInInitializer(global.init, global.type);
            }
        }
        for (const fn of this.program.functions) {
            if (fn.body) {
                this.collectStaticStringsInStatement(fn.body);
            }
        }
    }

    private collectStaticStringsInStatement(stmt: Statement): void {
        switch (stmt.kind) {
            case 'block':
                stmt.statements.forEach((inner) => this.collectStaticStringsInStatement(inner));
                return;
            case 'var':
                if (stmt.init) this.collectStaticStringsInInitializer(stmt.init, stmt.type);
                return;
            case 'expr':
                this.collectStaticStringsInExpr(stmt.expr);
                return;
            case 'if':
                this.collectStaticStringsInExpr(stmt.test);
                this.collectStaticStringsInStatement(stmt.thenBranch);
                if (stmt.elseBranch) this.collectStaticStringsInStatement(stmt.elseBranch);
                return;
            case 'while':
                this.collectStaticStringsInExpr(stmt.test);
                this.collectStaticStringsInStatement(stmt.body);
                return;
            case 'for':
                if (stmt.init) {
                    if (isVarDecl(stmt.init)) this.collectStaticStringsInStatement(stmt.init);
                    else this.collectStaticStringsInExpr(stmt.init);
                }
                if (stmt.test) this.collectStaticStringsInExpr(stmt.test);
                if (stmt.step) this.collectStaticStringsInExpr(stmt.step);
                this.collectStaticStringsInStatement(stmt.body);
                return;
            case 'return':
                if (stmt.expr) this.collectStaticStringsInExpr(stmt.expr);
                return;
            case 'label':
                this.collectStaticStringsInStatement(stmt.statement);
                return;
            case 'break':
            case 'continue':
            case 'goto':
            case 'empty':
                return;
        }
    }

    private collectStaticStringsInInitializer(init: Initializer, type: CType): void {
        switch (init.kind) {
            case 'expr-init':
                if (isArrayType(type) && init.expr.kind === 'string') {
                    return;
                }
                this.collectStaticStringsInExpr(init.expr);
                return;
            case 'list-init':
                init.values.forEach((value) => {
                    if (!isArrayType(type) || value.kind !== 'string') {
                        this.collectStaticStringsInExpr(value);
                    }
                });
                return;
        }
    }

    private collectStaticStringsInExpr(expr: Expr): void {
        switch (expr.kind) {
            case 'string': {
                const key = this.staticStringKey(expr.bytes);
                if (!this.staticStrings.has(key)) {
                    this.staticStrings.set(key, { bytes: expr.bytes, address: this.nextGlobalAddress });
                    this.nextGlobalAddress += expr.bytes.length + 1;
                    this.ensureStaticDataFits(expr.line, expr.column);
                }
                return;
            }
            case 'assign':
                this.collectStaticStringsInExpr(expr.target);
                this.collectStaticStringsInExpr(expr.value);
                return;
            case 'compound-assign':
                this.collectStaticStringsInExpr(expr.target);
                this.collectStaticStringsInExpr(expr.value);
                return;
            case 'update':
                this.collectStaticStringsInExpr(expr.target);
                return;
            case 'conditional':
                this.collectStaticStringsInExpr(expr.test);
                this.collectStaticStringsInExpr(expr.consequent);
                this.collectStaticStringsInExpr(expr.alternate);
                return;
            case 'binary':
                this.collectStaticStringsInExpr(expr.left);
                this.collectStaticStringsInExpr(expr.right);
                return;
            case 'unary':
            case 'cast':
                this.collectStaticStringsInExpr(expr.expr);
                return;
            case 'index':
                this.collectStaticStringsInExpr(expr.target);
                this.collectStaticStringsInExpr(expr.index);
                return;
            case 'call':
                expr.args.forEach((arg) => this.collectStaticStringsInExpr(arg));
                return;
            case 'number':
            case 'varref':
                return;
        }
    }

    private staticStringAddress(expr: StringExpr): number {
        const entry = this.staticStrings.get(this.staticStringKey(expr.bytes));
        if (!entry) {
            throw new CompilerError('internal error: missing static string', expr.line, expr.column);
        }
        return entry.address;
    }

    private staticStringKey(bytes: number[]): string {
        return bytes.join(',');
    }

    private ensureStaticDataFits(line?: number, column?: number): void {
        if (this.nextGlobalAddress > this.dataLimit) {
            throw new CompilerError('static data exceeds DLB address space', line, column);
        }
    }

    private emitInterruptVector(label: string): void {
        this.emit(`${label}:`);
        this.emit(`jmp ${IRQ_HANDLER_NAME}`);
    }

    private emitFunction(fn: FunctionDecl): void {
        if (!fn.body) {
            return;
        }

        const isInterruptHandler = fn.name === IRQ_HANDLER_NAME;
        const layout = this.buildLayout(fn);
        const ctx: FunctionContext = {
            fn,
            layout,
            returnLabel: this.allocateInternalLabel(`__${fn.name}_return`),
            breakLabels: [],
            continueLabels: [],
            tempDepth: 0,
            labelId: 0,
        };
        this.current = ctx;

        this.emit(`${fn.name}:`);
        this.adjustSp(-layout.frameSize);
        this.emit('mov [r13 + 0], r14');
        this.emit('mov [r13 + 4], r12');
        if (isInterruptHandler) {
            IRQ_CONTEXT_REGS.forEach((reg, index) => {
                this.emit(`mov [r13 + ${8 + index * 4}], ${reg}`);
            });
        }
        this.emit('mov r12, r13');

        fn.params.forEach((param, index) => {
            const slot = layout.slots.get(param.name);
            if (!slot?.offset) {
                throw new CompilerError(`internal error: missing parameter '${param.name}'`);
            }
            if (index < 4) {
                this.storeVar(param.name, ABI_ARG_REGS[index]);
            } else {
                const sourceOffset = layout.frameSize + (index - 4) * 4;
                this.emit(`mov r7, [r12 + ${sourceOffset}]`);
                this.storeVar(param.name, 'r7');
            }
        });

        this.emitStatement(fn.body);
        if (isVoidType(fn.returnType)) {
            this.loadImm(ABI_RETURN_REG, 0);
        }
        this.emit(`jmp ${ctx.returnLabel}`);

        this.emit(`${ctx.returnLabel}:`);
        if (isInterruptHandler) {
            this.emit('mov r14, [r12 + 0]');
            IRQ_CONTEXT_REGS.forEach((reg, index) => {
                this.emit(`mov ${reg}, [r12 + ${8 + index * 4}]`);
            });
            this.emit(`mov r13, r12 + ${layout.frameSize}`);
            this.emit('mov r12, [r12 + 4]');
            this.emit('mov r1, r1 | 1');
            this.emit('jmp r3');
        } else {
            this.emit('mov r14, [r12 + 0]');
            this.emit('mov r8, [r12 + 4]');
            this.emit(`mov r13, r12 + ${layout.frameSize}`);
            this.emit('mov r12, r8');
            this.emit('jmp r14');
        }
        this.current = undefined;
    }

    private buildLayout(fn: FunctionDecl): FunctionLayout {
        if (!fn.body) {
            throw new CompilerError(`function '${fn.name}' has no body`);
        }

        const slots = new Map<string, Slot>();
        let offset = fn.name === IRQ_HANDLER_NAME
            ? 8 + IRQ_CONTEXT_REGS.length * 4
            : 8;
        for (const param of fn.params) {
            if (slots.has(param.name)) {
                throw new CompilerError(`duplicate parameter '${param.name}' in function '${fn.name}'`);
            }
            offset = alignTo(offset, typeAlignmentBytes(param.type));
            const sizeBytes = typeSizeBytes(param.type);
            slots.set(param.name, { type: param.type, offset, sizeBytes });
            offset += sizeBytes;
        }

        const collector = new FunctionCollector(fn.name, slots, offset);
        collector.collect(fn.body);
        offset = align4(collector.nextOffset);
        const tempBase = offset;
        offset += this.tempSlots * 4;
        offset += Math.max(collector.maxCallArgs, 1) * 4;
        const frameSize = align4(offset);

        return {
            slots,
            frameSize,
            tempBase,
            tempSlots: this.tempSlots,
            maxCallArgs: collector.maxCallArgs,
        };
    }

    private emitStatement(stmt: Statement): void {
        switch (stmt.kind) {
            case 'block':
                for (const inner of stmt.statements) {
                    this.emitStatement(inner);
                }
                return;
            case 'var':
                if (stmt.init) {
                    if (isArrayType(stmt.type)) {
                        this.emitLocalArrayInitializer(stmt);
                    } else {
                        this.emitExpr(this.exprInitializer(stmt.init), 'r7');
                        this.storeVar(stmt.name, 'r7');
                    }
                }
                return;
            case 'expr':
                this.emitExpr(stmt.expr, 'r7', false);
                return;
            case 'return':
                if (stmt.expr) {
                    this.emitExpr(stmt.expr, ABI_RETURN_REG);
                    this.convertValue(ABI_RETURN_REG, this.ctx().fn.returnType);
                } else {
                    this.loadImm(ABI_RETURN_REG, 0);
                }
                this.emit(`jmp ${this.ctx().returnLabel}`);
                return;
            case 'if': {
                const elseLabel = this.newLabel('else');
                const endLabel = this.newLabel('endif');
                this.emitBranchIfFalse(stmt.test, elseLabel);
                this.emitStatement(stmt.thenBranch);
                this.emit(`jmp ${endLabel}`);
                this.emit(`${elseLabel}:`);
                if (stmt.elseBranch) {
                    this.emitStatement(stmt.elseBranch);
                }
                this.emit(`${endLabel}:`);
                return;
            }
            case 'while': {
                const startLabel = this.newLabel('while');
                const endLabel = this.newLabel('endwhile');
                this.emit(`${startLabel}:`);
                this.emitBranchIfFalse(stmt.test, endLabel);
                this.ctx().breakLabels.push(endLabel);
                this.ctx().continueLabels.push(startLabel);
                this.emitStatement(stmt.body);
                this.ctx().breakLabels.pop();
                this.ctx().continueLabels.pop();
                this.emit(`jmp ${startLabel}`);
                this.emit(`${endLabel}:`);
                return;
            }
            case 'for': {
                const startLabel = this.newLabel('for');
                const stepLabel = this.newLabel('for_step');
                const endLabel = this.newLabel('endfor');
                if (stmt.init) {
                    if (isVarDecl(stmt.init)) {
                        this.emitStatement(stmt.init);
                    } else {
                        this.emitExpr(stmt.init, 'r7');
                    }
                }
                this.emit(`${startLabel}:`);
                if (stmt.test) {
                    this.emitBranchIfFalse(stmt.test, endLabel);
                }
                this.ctx().breakLabels.push(endLabel);
                this.ctx().continueLabels.push(stepLabel);
                this.emitStatement(stmt.body);
                this.ctx().breakLabels.pop();
                this.ctx().continueLabels.pop();
                this.emit(`${stepLabel}:`);
                if (stmt.step) {
                    this.emitExpr(stmt.step, 'r7');
                }
                this.emit(`jmp ${startLabel}`);
                this.emit(`${endLabel}:`);
                return;
            }
            case 'break': {
                const label = last(this.ctx().breakLabels);
                if (!label) throw new CompilerError('break used outside loop');
                this.emit(`jmp ${label}`);
                return;
            }
            case 'continue': {
                const label = last(this.ctx().continueLabels);
                if (!label) throw new CompilerError('continue used outside loop');
                this.emit(`jmp ${label}`);
                return;
            }
            case 'goto':
                this.emit(`jmp ${this.userLabel(stmt.label)}`);
                return;
            case 'label':
                this.emit(`${this.userLabel(stmt.label)}:`);
                this.emitStatement(stmt.statement);
                return;
            case 'empty':
                return;
        }
    }

    private emitLocalArrayInitializer(stmt: VarDeclStmt): void {
        if (!stmt.init) {
            return;
        }
        this.validateArrayListInitializer(stmt.type, stmt.init);
        const slot = this.lookupVar(stmt.name);
        if (slot.offset === undefined) {
            throw new CompilerError(`internal error: local array '${stmt.name}' has no offset`);
        }
        const normalized = normalizeArrayInitializer(stmt.type, stmt.init);
        const elementType = arrayElementType(stmt.type);
        const elementSize = typeSizeBytes(elementType);
        let index = 0;

        if (normalized.kind === 'expr-elements') {
            for (const expr of normalized.values) {
                this.emitExpr(expr, 'r7');
                this.convertValue('r7', elementType);
                this.emitStoreToAddress(`r12 + ${slot.offset + index * elementSize}`, 'r7', elementType);
                index++;
            }
        } else {
            for (const value of normalized.values) {
                this.loadImm('r7', value);
                this.emitStoreToAddress(`r12 + ${slot.offset + index * elementSize}`, 'r7', elementType);
                index++;
            }
        }

        if (normalized.zeroFill <= MAX_INLINE_LOCAL_ARRAY_ZERO_STORES) {
            for (let count = 0; count < normalized.zeroFill; count++, index++) {
                this.loadImm('r7', 0);
                this.emitStoreToAddress(`r12 + ${slot.offset + index * elementSize}`, 'r7', elementType);
            }
            return;
        }

        const loopLabel = this.newLabel('array_zero');
        this.loadImm('r8', slot.offset + index * elementSize);
        this.emit('mov r8, r12 + r8');
        this.loadImm('r7', normalized.zeroFill);
        this.emit(`${loopLabel}:`);
        this.emitStoreToAddress('r8', 'r0', elementType);
        this.emit(`mov r8, r8 + ${elementSize}`);
        this.emit('mov r7, r7 - 1');
        this.emit(`bnz r7, r0 + ${loopLabel}`);
    }

    private emitExpr(expr: Expr, target: string, valueRequired = true): CType {
        this.requireExpressionValue(expr, this.exprType(expr), valueRequired);
        switch (expr.kind) {
            case 'number':
                this.loadImm(target, expr.value);
                return intType();
            case 'string':
                this.loadImm(target, this.staticStringAddress(expr));
                return pointerTo({ base: 'char', pointerDepth: 0, volatile: false });
            case 'varref':
                if (isArrayType(this.lookupVar(expr.name).type)) {
                    this.emitLValueAddress(expr, target);
                    return arrayDecayType(this.lookupVar(expr.name).type);
                }
                this.loadVar(expr.name, target);
                return this.lookupVar(expr.name).type;
            case 'assign': {
                this.emitExpr(expr.value, target);
                const type = this.lvalueType(expr.target);
                this.convertValue(target, type);
                this.storeLValue(expr.target, target);
                return type;
            }
            case 'compound-assign':
                return this.emitCompoundAssignment(expr, target);
            case 'update':
                return this.emitUpdate(expr, target);
            case 'conditional':
                return this.emitConditional(expr, target);
            case 'unary':
                return this.emitUnary(expr, target);
            case 'binary':
                return this.emitBinary(expr, target);
            case 'call':
                return this.emitCall(expr, target, valueRequired);
            case 'cast':
                if (isVoidType(expr.type)) {
                    this.emitExpr(expr.expr, target, false);
                    return voidType();
                }
                this.emitExpr(expr.expr, target);
                this.convertValue(target, expr.type);
                return expr.type;
            case 'index': {
                const elementType = this.indexElementType(expr);
                this.emitIndexAddress(expr, 'r8');
                this.emitLoadFromAddress(target, 'r8', elementType);
                return elementType;
            }
        }
    }

    private emitConditional(expr: ConditionalExpr, target: string): CType {
        const resultType = this.conditionalResultType(expr);
        const resultIsVoid = isVoidType(resultType);
        const falseLabel = this.newLabel('conditional_false');
        const trueLabel = this.newLabel('conditional_true');
        const endLabel = this.newLabel('conditional_end');

        this.emitBranchIfFalse(expr.test, falseLabel);
        this.emit(`${trueLabel}:`);
        this.emitExpr(expr.consequent, target, !resultIsVoid);
        if (!resultIsVoid) {
            this.convertValue(target, resultType);
        }
        this.emit(`jmp ${endLabel}`);
        this.emit(`${falseLabel}:`);
        this.emitExpr(expr.alternate, target, !resultIsVoid);
        if (!resultIsVoid) {
            this.convertValue(target, resultType);
        }
        this.emit(`${endLabel}:`);
        return resultType;
    }

    private emitCompoundAssignment(expr: CompoundAssignExpr, target: string): CType {
        const addressTemp = this.allocTemp();
        const valueType = this.emitLValueAddress(expr.target, 'r8');
        this.validateCompoundTarget(expr, valueType);
        this.storeTemp(addressTemp, 'r8');

        const oldValueTemp = this.allocTemp();
        this.emitLoadFromAddress('r7', 'r8', valueType);
        this.storeTemp(oldValueTemp, 'r7');
        const rightType = this.emitExpr(expr.value, 'r8');
        this.loadTemp(oldValueTemp, 'r7');
        this.freeTemp();

        this.validateCompoundOperands(expr, valueType, rightType);
        this.emitBinaryOperation(expr.op, valueType, rightType, 'r7');
        this.convertValue('r7', valueType);
        this.loadTemp(addressTemp, 'r8');
        this.freeTemp();
        this.emitStoreToAddress('r8', 'r7', valueType);
        if (target !== 'r7') {
            this.emit(`mov ${target}, r7`);
        }
        return valueType;
    }

    private emitUpdate(expr: UpdateExpr, target: string): CType {
        const addressTemp = this.allocTemp();
        const valueType = this.emitLValueAddress(expr.target, 'r8');
        this.validateUpdateTarget(expr, valueType);
        this.storeTemp(addressTemp, 'r8');
        this.emitLoadFromAddress('r7', 'r8', valueType);

        let oldValueTemp: number | undefined;
        if (!expr.prefix) {
            oldValueTemp = this.allocTemp();
            this.storeTemp(oldValueTemp, 'r7');
        }

        this.loadImm('r8', 1);
        this.emitBinaryOperation(expr.delta === 1 ? '+' : '-', valueType, intType(), 'r7');
        this.convertValue('r7', valueType);
        this.loadTemp(addressTemp, 'r8');
        this.emitStoreToAddress('r8', 'r7', valueType);

        if (oldValueTemp !== undefined) {
            this.loadTemp(oldValueTemp, target);
            this.freeTemp();
        } else if (target !== 'r7') {
            this.emit(`mov ${target}, r7`);
        }
        this.freeTemp();
        return valueType;
    }

    private validateCompoundTarget(expr: CompoundAssignExpr, type: CType): void {
        this.validateModifiableUpdateType(type, expr.line, expr.column);
        if (type.pointerDepth > 0 && expr.op !== '+' && expr.op !== '-') {
            throw new CompilerError(
                `operator '${expr.op}=' is not valid for a pointer target`,
                expr.line,
                expr.column,
            );
        }
    }

    private validateCompoundOperands(expr: CompoundAssignExpr, targetType: CType, rightType: CType): void {
        if (targetType.pointerDepth > 0) {
            if (!isIntegerType(rightType)) {
                throw new CompilerError(
                    'pointer compound assignment requires an integer right operand',
                    expr.line,
                    expr.column,
                );
            }
            return;
        }
        if (!isIntegerType(rightType)) {
            throw new CompilerError(
                `operator '${expr.op}=' requires integer operands`,
                expr.line,
                expr.column,
            );
        }
    }

    private validateUpdateTarget(expr: UpdateExpr, type: CType): void {
        this.validateModifiableUpdateType(type, expr.line, expr.column);
    }

    private validateModifiableUpdateType(type: CType, line: number, column: number): void {
        if (isArrayType(type)) {
            throw new CompilerError('array object cannot be updated', line, column);
        }
        if (type.pointerDepth === 0 && !isIntegerType(type)) {
            throw new CompilerError('update target must have integer or pointer type', line, column);
        }
    }

    private emitUnary(expr: UnaryExpr, target: string): CType {
        if (expr.op === '&') {
            return pointerTo(this.emitLValueAddress(expr.expr, target));
        }
        if (expr.op === '*') {
            const pointerType = this.emitExpr(expr.expr, 'r8');
            if (pointerType.pointerDepth < 1) {
                throw new CompilerError('cannot dereference a non-pointer expression');
            }
            const valueType = derefType(pointerType);
            this.emitLoadFromAddress(target, 'r8', valueType);
            return valueType;
        }

        this.validateUnaryOperand(expr);
        const type = this.emitExpr(expr.expr, target);
        if (expr.op === '-') {
            this.emit(`mov ${target}, r0 - ${target}`);
            return promoteIntegerType(type);
        }
        if (expr.op === '~') {
            this.loadImm('r8', -1);
            this.emit(`mov ${target}, ${target} ^ r8`);
            return promoteIntegerType(type);
        }
        if (expr.op === '!') {
            this.emit(`cmp ${target}, ${target} == 0`);
            return intType();
        }
        throw new CompilerError(`unsupported unary operator '${expr.op}'`);
    }

    private emitBinary(expr: BinaryExpr, target: string): CType {
        this.validateBinaryOperands(expr);
        if (expr.op === '&&' || expr.op === '||') {
            return this.emitLogical(expr, target);
        }

        if (isComparison(expr.op)) {
            return this.emitComparisonValue(expr, target);
        }

        const temp = this.allocTemp();
        const leftType = this.emitExpr(expr.left, 'r7');
        this.storeTemp(temp, 'r7');
        const rightType = this.emitExpr(expr.right, 'r8');
        this.loadTemp(temp, 'r7');
        this.freeTemp();
        return this.emitBinaryOperation(expr.op, leftType, rightType, target);
    }

    private emitBinaryOperation(op: string, leftType: CType, rightType: CType, target: string): CType {
        const resultType = this.binaryResultType(op, leftType, rightType);
        if (['*', '/', '%'].includes(op) && (leftType.pointerDepth > 0 || rightType.pointerDepth > 0)) {
            throw new CompilerError(`operator '${op}' does not accept pointer operands`);
        }
        if (op === '+' && leftType.pointerDepth > 0 && rightType.pointerDepth > 0) {
            throw new CompilerError("operator '+' cannot add two pointers");
        }
        this.scalePointerOperand(op, leftType, rightType);

        switch (op) {
            case '+':
                this.emit(`mov ${target}, r7 + r8`);
                break;
            case '-':
                this.emit(`mov ${target}, r7 - r8`);
                if (leftType.pointerDepth > 0 && rightType.pointerDepth > 0) {
                    this.scalePointerDifference(target, leftType, rightType);
                }
                break;
            case '*':
                this.emit(`mul ${target}, r7, r8`);
                break;
            case '/':
                this.emit(`${isUnsignedType(resultType) ? 'divu' : 'div'} ${target}, r7, r8`);
                break;
            case '%':
                this.emit(`${isUnsignedType(resultType) ? 'remu' : 'rem'} ${target}, r7, r8`);
                break;
            case '&':
                this.emit(`mov ${target}, r7 & r8`);
                break;
            case '|':
                this.emit(`mov ${target}, r7 | r8`);
                break;
            case '^':
                this.emit(`mov ${target}, r7 ^ r8`);
                break;
            case '<<':
                this.emit(`mov ${target}, r7 << r8`);
                break;
            case '>>':
                this.emit(`mov ${target}, r7 ${isUnsignedType(promoteIntegerType(leftType)) ? '>>' : '>>>'} r8`);
                break;
            default:
                throw new CompilerError(`unsupported binary operator '${op}'`);
        }

        return resultType;
    }

    private emitLogical(expr: BinaryExpr, target: string): CType {
        const falseLabel = this.newLabel('logic_false');
        const trueLabel = this.newLabel('logic_true');
        const endLabel = this.newLabel('logic_end');

        if (expr.op === '&&') {
            this.emitBranchIfFalse(expr.left, falseLabel);
            this.emitBranchIfFalse(expr.right, falseLabel);
            this.emit(`jmp ${trueLabel}`);
        } else {
            this.emitBranchIfTrue(expr.left, trueLabel);
            this.emitBranchIfTrue(expr.right, trueLabel);
            this.emit(`jmp ${falseLabel}`);
        }

        this.emit(`${trueLabel}:`);
        this.loadImm(target, 1);
        this.emit(`jmp ${endLabel}`);
        this.emit(`${falseLabel}:`);
        this.loadImm(target, 0);
        this.emit(`${endLabel}:`);
        return intType();
    }

    private emitComparisonValue(expr: BinaryExpr, target: string): CType {
        const mnemonic = this.shouldUseUnsignedCompare(expr.left, expr.right) ? 'cmpu' : 'cmp';
        const temp = this.allocTemp();
        this.emitExpr(expr.left, 'r7');
        this.storeTemp(temp, 'r7');
        this.emitExpr(expr.right, 'r8');
        this.loadTemp(temp, 'r7');
        this.freeTemp();
        this.emit(`${mnemonic} ${target}, r7 ${expr.op} r8`);
        return intType();
    }

    private emitCall(expr: CallExpr, target: string, valueRequired: boolean): CType {
        if (expr.name === '__irq_enable' || expr.name === '__irq_disable') {
            if (expr.args.length !== 0) {
                throw new CompilerError(`${expr.name} expects 0 arguments`);
            }
            if (!this.interruptHandler) {
                throw new CompilerError(`${expr.name} requires a defined __irq_handler`);
            }
            this.emit(`mov r1, ${expr.name === '__irq_enable' ? 1 : 0}`);
            return voidType();
        }
        if (expr.name === '__load32') {
            if (expr.args.length !== 1) throw new CompilerError('__load32 expects 1 argument');
            this.emitExpr(expr.args[0], 'r8');
            this.emit(`mov ${target}, [r8]`);
            return uintType();
        }
        if (expr.name === '__store32') {
            if (expr.args.length !== 2) throw new CompilerError('__store32 expects 2 arguments');
            const temp = this.allocTemp();
            this.emitExpr(expr.args[0], 'r7');
            this.storeTemp(temp, 'r7');
            this.emitExpr(expr.args[1], 'r8');
            this.loadTemp(temp, 'r7');
            this.freeTemp();
            this.emit('mov [r7], r8');
            if (valueRequired && target !== 'r8') {
                this.emit(`mov ${target}, r8`);
            }
            return uintType();
        }

        const fn = this.functionMap.get(expr.name);
        if (!fn) {
            throw new CompilerError(`unknown function '${expr.name}'`);
        }

        const ctx = this.ctx();
        if (expr.args.length > ctx.layout.maxCallArgs) {
            throw new CompilerError(`internal error: call to '${expr.name}' exceeds allocated argument staging slots`);
        }

        const argTemps: number[] = [];
        expr.args.forEach((arg) => {
            const temp = this.allocTemp();
            this.emitExpr(arg, 'r7');
            this.storeTemp(temp, 'r7');
            argTemps.push(temp);
        });

        const extraArgs = Math.max(0, expr.args.length - 4);
        const extraBytes = extraArgs * 4;
        if (extraBytes > 0) {
            this.adjustSp(-extraBytes);
            for (let i = 4; i < expr.args.length; i++) {
                this.loadTemp(argTemps[i], 'r7');
                this.emit(`mov [r13 + ${(i - 4) * 4}], r7`);
            }
        }

        for (let i = 0; i < Math.min(4, expr.args.length); i++) {
            this.loadTemp(argTemps[i], ABI_ARG_REGS[i]);
        }

        this.emit(`jmp ${expr.name}, r14`);

        if (extraBytes > 0) {
            this.adjustSp(extraBytes);
        }
        if (valueRequired && target !== ABI_RETURN_REG) {
            this.emit(`mov ${target}, ${ABI_RETURN_REG}`);
        }
        for (let i = 0; i < argTemps.length; i++) {
            this.freeTemp();
        }
        return fn.returnType;
    }

    private emitBranchIfFalse(expr: Expr, label: string): void {
        this.emitExpr(expr, 'r7');
        this.emit(`bz r7, r0 + ${label}`);
    }

    private emitBranchIfTrue(expr: Expr, label: string): void {
        this.emitExpr(expr, 'r7');
        this.emit(`bnz r7, r0 + ${label}`);
    }

    private loadVar(name: string, target: string): void {
        const slot = this.lookupVar(name);
        if (slot.globalAddress !== undefined) {
            this.loadImm('r8', slot.globalAddress);
            this.emitLoadFromAddress(target, 'r8', slot.type);
            return;
        }
        if (slot.offset === undefined) {
            throw new CompilerError(`internal error: missing offset for '${name}'`);
        }
        this.emitLoadFromAddress(target, `r12 + ${slot.offset}`, slot.type);
    }

    private storeVar(name: string, source: string): void {
        const slot = this.lookupVar(name);
        if (slot.globalAddress !== undefined) {
            this.loadImm('r8', slot.globalAddress);
            this.emitStoreToAddress('r8', source, slot.type);
            return;
        }
        if (slot.offset === undefined) {
            throw new CompilerError(`internal error: missing offset for '${name}'`);
        }
        this.emitStoreToAddress(`r12 + ${slot.offset}`, source, slot.type);
    }

    private storeLValue(targetExpr: Expr, source: string): void {
        if (targetExpr.kind === 'varref') {
            this.storeVar(targetExpr.name, source);
            return;
        }
        if (targetExpr.kind === 'unary' && targetExpr.op === '*') {
            const temp = this.allocTemp();
            this.storeTemp(temp, source);
            const pointerType = this.emitExpr(targetExpr.expr, 'r8');
            if (pointerType.pointerDepth < 1) {
                throw new CompilerError('cannot assign through a non-pointer expression');
            }
            const valueType = derefType(pointerType);
            this.loadTemp(temp, source);
            this.freeTemp();
            this.emitStoreToAddress('r8', source, valueType);
            return;
        }
        if (targetExpr.kind === 'index') {
            const temp = this.allocTemp();
            this.storeTemp(temp, source);
            this.emitIndexAddress(targetExpr, 'r8');
            this.loadTemp(temp, source);
            this.freeTemp();
            this.emitStoreToAddress('r8', source, this.indexElementType(targetExpr));
            return;
        }
        throw new CompilerError('unsupported assignment target');
    }

    private emitLoadFromAddress(target: string, address: string, type: CType): void {
        this.emit(`${loadMnemonic(type)} ${target}, [${address}]`);
    }

    private emitStoreToAddress(address: string, source: string, type: CType): void {
        this.emit(`${storeMnemonic(type)} [${address}], ${source}`);
    }

    private convertValue(register: string, type: CType): void {
        if (type.pointerDepth > 0) {
            return;
        }
        switch (type.base) {
            case 'char':
                this.emit(`mov ${register}, ${register} << 24`);
                this.emit(`mov ${register}, ${register} >>> 24`);
                return;
            case 'uchar':
                this.emit(`mov ${register}, ${register} & 0xFF`);
                return;
            case 'short':
                this.emit(`mov ${register}, ${register} << 16`);
                this.emit(`mov ${register}, ${register} >>> 16`);
                return;
            case 'ushort':
                this.emit(`mov ${register}, ${register} & 0xFFFF`);
                return;
            default:
                return;
        }
    }

    private emitLValueAddress(expr: Expr, target: string): CType {
        if (expr.kind === 'varref') {
            const slot = this.lookupVar(expr.name);
            if (slot.globalAddress !== undefined) {
                this.loadImm(target, slot.globalAddress);
                return slot.type;
            }
            if (slot.offset === undefined) {
                throw new CompilerError(`internal error: missing offset for '${expr.name}'`);
            }
            this.emit(`mov ${target}, r12 + ${slot.offset}`);
            return slot.type;
        }
        if (expr.kind === 'index') {
            const elementType = this.indexElementType(expr);
            this.emitIndexAddress(expr, target);
            return elementType;
        }
        if (expr.kind === 'unary' && expr.op === '*') {
            const pointerType = this.emitExpr(expr.expr, target);
            if (pointerType.pointerDepth < 1) {
                throw new CompilerError('cannot assign through a non-pointer expression');
            }
            return derefType(pointerType);
        }
        throw new CompilerError('address-of requires a variable or dereference');
    }

    private lookupVar(name: string): Slot {
        const local = this.current?.layout.slots.get(name);
        if (local) {
            return local;
        }
        const global = this.globals.get(name);
        if (global) {
            return global;
        }
        throw new CompilerError(`unknown variable '${name}'`);
    }

    private lvalueType(expr: Expr): CType {
        if (expr.kind === 'varref') {
            return this.lookupVar(expr.name).type;
        }
        if (expr.kind === 'unary' && expr.op === '*') {
            return derefType(this.exprType(expr.expr));
        }
        if (expr.kind === 'index') {
            return this.indexElementType(expr);
        }
        throw new CompilerError('expression is not an lvalue');
    }

    private exprType(expr: Expr): CType {
        switch (expr.kind) {
            case 'number':
                return intType();
            case 'string':
                return pointerTo({ base: 'char', pointerDepth: 0, volatile: false });
            case 'varref':
                return arrayDecayType(this.lookupVar(expr.name).type);
            case 'assign':
                return this.lvalueType(expr.target);
            case 'compound-assign':
            case 'update':
                return this.lvalueType(expr.target);
            case 'conditional':
                return this.conditionalResultType(expr);
            case 'index':
                return this.indexElementType(expr);
            case 'unary':
                if (expr.op === '!') return intType();
                if (expr.op === '&') return pointerTo(this.lvalueType(expr.expr));
                if (expr.op === '*') return derefType(this.exprType(expr.expr));
                return promoteIntegerType(this.exprType(expr.expr));
            case 'binary':
                if (isComparison(expr.op) || expr.op === '&&' || expr.op === '||') return intType();
                return this.binaryResultType(expr.op, this.exprType(expr.left), this.exprType(expr.right));
            case 'call':
                if (expr.name === '__irq_enable' || expr.name === '__irq_disable') return voidType();
                if (expr.name === '__load32' || expr.name === '__store32') return uintType();
                return this.functionMap.get(expr.name)?.returnType || intType();
            case 'cast':
                return expr.type;
        }
    }

    private conditionalResultType(expr: ConditionalExpr): CType {
        const testType = this.exprType(expr.test);
        if (isVoidType(testType)) {
            throw new CompilerError(
                'conditional expression condition must have scalar type',
                expr.line,
                expr.column,
            );
        }

        const consequentType = this.exprType(expr.consequent);
        const alternateType = this.exprType(expr.alternate);
        const consequentIsVoid = isVoidType(consequentType);
        const alternateIsVoid = isVoidType(alternateType);
        if (consequentIsVoid || alternateIsVoid) {
            if (consequentIsVoid && alternateIsVoid) {
                return voidType();
            }
            throw new CompilerError(
                'conditional expression branches must both have void type or both produce values',
                expr.line,
                expr.column,
            );
        }

        if (isIntegerType(consequentType) && isIntegerType(alternateType)) {
            return usualArithmeticType(consequentType, alternateType);
        }

        if (consequentType.pointerDepth > 0 && alternateType.pointerDepth > 0) {
            if (consequentType.base !== alternateType.base
                || consequentType.pointerDepth !== alternateType.pointerDepth) {
                throw new CompilerError(
                    'conditional expression has incompatible pointer branch types',
                    expr.line,
                    expr.column,
                );
            }
            return {
                base: consequentType.base,
                pointerDepth: consequentType.pointerDepth,
                volatile: consequentType.volatile || alternateType.volatile,
            };
        }

        if (consequentType.pointerDepth > 0 && isIntegerType(alternateType)) {
            if (this.isIntegerConstantZero(expr.alternate)) {
                return consequentType;
            }
            throw new CompilerError(
                'conditional expression cannot combine a pointer with a nonzero integer',
                expr.line,
                expr.column,
            );
        }

        if (alternateType.pointerDepth > 0 && isIntegerType(consequentType)) {
            if (this.isIntegerConstantZero(expr.consequent)) {
                return alternateType;
            }
            throw new CompilerError(
                'conditional expression cannot combine a pointer with a nonzero integer',
                expr.line,
                expr.column,
            );
        }

        throw new CompilerError(
            'conditional expression branches have incompatible types',
            expr.line,
            expr.column,
        );
    }

    private isIntegerConstantZero(expr: Expr): boolean {
        if (!this.isIntegerConstantExpression(expr)) {
            return false;
        }
        return this.evalIntegerConstantExpression(expr).value === 0;
    }

    private isIntegerConstantExpression(expr: Expr): boolean {
        switch (expr.kind) {
            case 'number':
                return true;
            case 'cast':
                return isIntegerType(expr.type) && this.isIntegerConstantExpression(expr.expr);
            case 'unary':
                return ['-', '~', '!'].includes(expr.op)
                    && this.isIntegerConstantExpression(expr.expr)
                    && isIntegerType(this.exprType(expr.expr));
            case 'binary':
                return [
                    '+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>',
                    '==', '!=', '<', '<=', '>', '>=', '&&', '||',
                ].includes(expr.op)
                    && this.isIntegerConstantExpression(expr.left)
                    && this.isIntegerConstantExpression(expr.right)
                    && isIntegerType(this.exprType(expr.left))
                    && isIntegerType(this.exprType(expr.right));
            case 'conditional':
                return this.isIntegerConstantExpression(expr.test)
                    && this.isIntegerConstantExpression(expr.consequent)
                    && this.isIntegerConstantExpression(expr.alternate)
                    && isIntegerType(this.conditionalResultType(expr));
            case 'string':
            case 'varref':
            case 'assign':
            case 'compound-assign':
            case 'update':
            case 'call':
            case 'index':
                return false;
        }
    }

    private evalIntegerConstantExpression(expr: Expr): { value: number; type: CType } {
        switch (expr.kind) {
            case 'number':
                return { value: convertConstant(expr.value, intType()), type: intType() };
            case 'cast': {
                const operand = this.evalIntegerConstantExpression(expr.expr);
                return { value: convertConstant(operand.value, expr.type), type: expr.type };
            }
            case 'unary': {
                const operand = this.evalIntegerConstantExpression(expr.expr);
                if (expr.op === '!') {
                    return { value: operand.value ? 0 : 1, type: intType() };
                }
                const resultType = promoteIntegerType(operand.type);
                const value = convertConstant(operand.value, resultType);
                if (expr.op === '-') {
                    return { value: convertConstant(-value, resultType), type: resultType };
                }
                if (expr.op === '~') {
                    return { value: convertConstant(~value, resultType), type: resultType };
                }
                break;
            }
            case 'conditional': {
                const selected = this.evalIntegerConstantExpression(expr.test).value
                    ? expr.consequent
                    : expr.alternate;
                const selectedValue = this.evalIntegerConstantExpression(selected);
                const resultType = this.conditionalResultType(expr);
                return {
                    value: convertConstant(selectedValue.value, resultType),
                    type: resultType,
                };
            }
            case 'binary': {
                const left = this.evalIntegerConstantExpression(expr.left);
                if (expr.op === '&&') {
                    return {
                        value: left.value && this.evalIntegerConstantExpression(expr.right).value ? 1 : 0,
                        type: intType(),
                    };
                }
                if (expr.op === '||') {
                    return {
                        value: left.value || this.evalIntegerConstantExpression(expr.right).value ? 1 : 0,
                        type: intType(),
                    };
                }

                const right = this.evalIntegerConstantExpression(expr.right);
                if (expr.op === '<<' || expr.op === '>>') {
                    const resultType = promoteIntegerType(left.type);
                    const leftValue = convertConstant(left.value, resultType);
                    const rightValue = convertConstant(right.value, promoteIntegerType(right.type));
                    const value = expr.op === '<<'
                        ? leftValue << rightValue
                        : isUnsignedType(resultType)
                            ? leftValue >>> rightValue
                            : leftValue >> rightValue;
                    return { value: convertConstant(value, resultType), type: resultType };
                }

                const arithmeticType = usualArithmeticType(left.type, right.type);
                const leftValue = convertConstant(left.value, arithmeticType);
                const rightValue = convertConstant(right.value, arithmeticType);
                let value: number;
                switch (expr.op) {
                    case '+': value = leftValue + rightValue; break;
                    case '-': value = leftValue - rightValue; break;
                    case '*': value = Math.imul(leftValue, rightValue); break;
                    case '/':
                        if (rightValue === 0) {
                            throw new CompilerError('division by zero in integer constant expression');
                        }
                        value = Math.trunc(leftValue / rightValue);
                        break;
                    case '%':
                        if (rightValue === 0) {
                            throw new CompilerError('division by zero in integer constant expression');
                        }
                        value = leftValue % rightValue;
                        break;
                    case '&': value = leftValue & rightValue; break;
                    case '|': value = leftValue | rightValue; break;
                    case '^': value = leftValue ^ rightValue; break;
                    case '==': return { value: leftValue === rightValue ? 1 : 0, type: intType() };
                    case '!=': return { value: leftValue !== rightValue ? 1 : 0, type: intType() };
                    case '<': return { value: leftValue < rightValue ? 1 : 0, type: intType() };
                    case '<=': return { value: leftValue <= rightValue ? 1 : 0, type: intType() };
                    case '>': return { value: leftValue > rightValue ? 1 : 0, type: intType() };
                    case '>=': return { value: leftValue >= rightValue ? 1 : 0, type: intType() };
                    default:
                        throw new CompilerError('internal error: invalid integer constant expression');
                }
                return { value: convertConstant(value, arithmeticType), type: arithmeticType };
            }
            default:
                break;
        }
        throw new CompilerError('internal error: invalid integer constant expression');
    }

    private binaryResultType(op: string, leftType: CType, rightType: CType): CType {
        if (['+', '-'].includes(op)) {
            if (leftType.pointerDepth > 0 && rightType.pointerDepth === 0) return leftType;
            if (op === '+' && rightType.pointerDepth > 0 && leftType.pointerDepth === 0) return rightType;
            if (op === '-' && leftType.pointerDepth > 0 && rightType.pointerDepth > 0) return intType();
        }
        if (leftType.pointerDepth > 0 || rightType.pointerDepth > 0) {
            return uintType();
        }
        if (['<<', '>>'].includes(op)) {
            return promoteIntegerType(leftType);
        }
        return usualArithmeticType(leftType, rightType);
    }

    private scalePointerOperand(op: string, leftType: CType, rightType: CType): void {
        if (!['+', '-'].includes(op)) {
            return;
        }
        if (leftType.pointerDepth > 0 && rightType.pointerDepth === 0) {
            this.scaleRegister('r8', typeSizeBytes(derefType(leftType)));
            return;
        }
        if (op === '+' && rightType.pointerDepth > 0 && leftType.pointerDepth === 0) {
            this.scaleRegister('r7', typeSizeBytes(derefType(rightType)));
        }
    }

    private scalePointerDifference(target: string, leftType: CType, rightType: CType): void {
        const leftSize = this.pointerDifferenceElementSize(leftType, rightType);
        if (leftSize === 2) {
            this.emit(`mov ${target}, ${target} >>> 1`);
        } else if (leftSize === 4) {
            this.emit(`mov ${target}, ${target} >>> 2`);
        }
    }

    private pointerDifferenceElementSize(leftType: CType, rightType: CType): number {
        const leftSize = typeSizeBytes(derefType(leftType));
        const rightSize = typeSizeBytes(derefType(rightType));
        if (leftSize !== rightSize) {
            throw new CompilerError('cannot subtract pointers to differently sized types');
        }
        return leftSize;
    }

    private scaleRegister(register: string, sizeBytes: number): void {
        if (sizeBytes === 1) {
            return;
        }
        if (sizeBytes === 2) {
            this.emit(`mov ${register}, ${register} << 1`);
            return;
        }
        if (sizeBytes === 4) {
            this.emit(`mov ${register}, ${register} << 2`);
            return;
        }
        throw new CompilerError(`unsupported pointer element size ${sizeBytes}`);
    }

    private shouldUseUnsignedCompare(left: Expr, right: Expr): boolean {
        const leftType = this.exprType(left);
        const rightType = this.exprType(right);
        if (leftType.pointerDepth > 0 || rightType.pointerDepth > 0) {
            return true;
        }
        return isUnsignedType(usualArithmeticType(leftType, rightType));
    }

    private emitIndexAddress(expr: IndexExpr, target: string): void {
        const baseTemp = this.allocTemp();
        const baseType = this.emitExpr(expr.target, 'r7');
        if (baseType.pointerDepth < 1) {
            throw new CompilerError('index target must be an array or pointer');
        }
        this.storeTemp(baseTemp, 'r7');
        this.emitExpr(expr.index, 'r8');
        this.loadTemp(baseTemp, 'r7');
        this.freeTemp();
        this.scaleRegister('r8', typeSizeBytes(derefType(baseType)));
        this.emit(`mov ${target}, r7 + r8`);
    }

    private indexElementType(expr: IndexExpr): CType {
        const targetType = this.exprType(expr.target);
        if (targetType.pointerDepth < 1) {
            throw new CompilerError('index target must be an array or pointer');
        }
        return derefType(targetType);
    }

    private allocTemp(): number {
        const ctx = this.ctx();
        if (ctx.tempDepth >= ctx.layout.tempSlots) {
            throw new CompilerError(`expression too complex: exceeds ${ctx.layout.tempSlots} temporary slots`);
        }
        return ctx.tempDepth++;
    }

    private freeTemp(): void {
        const ctx = this.ctx();
        ctx.tempDepth--;
    }

    private storeTemp(index: number, reg: string): void {
        const offset = this.ctx().layout.tempBase + index * 4;
        this.emit(`mov [r12 + ${offset}], ${reg}`);
    }

    private loadTemp(index: number, reg: string): void {
        const offset = this.ctx().layout.tempBase + index * 4;
        this.emit(`mov ${reg}, [r12 + ${offset}]`);
    }

    private loadImm(reg: string, value: number): void {
        const unsigned = value >>> 0;
        if (value >= 0 && value <= 0xffff) {
            this.emit(`mov ${reg}, ${formatImm(value)}`);
            return;
        }

        const high = (unsigned >>> 16) & 0xffff;
        const low = unsigned & 0xffff;
        this.emit(`mov ${reg}, ${formatImm(high)}`);
        this.emit(`mov ${reg}, ${reg} << 16`);
        if (low !== 0) {
            this.emit(`mov ${reg}, ${reg} + ${formatImm(low)}`);
        }
    }

    private adjustSp(bytes: number): void {
        if (bytes === 0) {
            return;
        }
        if (bytes > 0) {
            this.emit(`mov r13, r13 + ${bytes}`);
        } else {
            this.emit(`mov r13, r13 - ${-bytes}`);
        }
    }

    private newLabel(prefix: string): string {
        const ctx = this.ctx();
        return this.allocateInternalLabel(`__${ctx.fn.name}_${prefix}_${ctx.labelId++}`);
    }

    private allocateInternalLabel(preferred: string): string {
        let label = preferred;
        while (this.occupiedAssemblyLabels.has(label)) {
            label = `${preferred}_internal_${this.internalLabelId++}`;
        }
        this.occupiedAssemblyLabels.add(label);
        return label;
    }

    private userLabel(label: string): string {
        return `__${this.ctx().fn.name}_${label}`;
    }

    private ctx(): FunctionContext {
        if (!this.current) {
            throw new CompilerError('internal error: no current function');
        }
        return this.current;
    }

    private emit(line: string): void {
        this.lines.push(line);
    }
}

class FunctionCollector {
    maxCallArgs = 0;
    nextOffset: number;

    constructor(
        private readonly functionName: string,
        private readonly slots: Map<string, Slot>,
        firstOffset = 8,
    ) {
        let maxOffset = firstOffset;
        for (const slot of slots.values()) {
            if (slot.offset !== undefined) {
                maxOffset = Math.max(maxOffset, slot.offset + slot.sizeBytes);
            }
        }
        this.nextOffset = maxOffset;
    }

    collect(stmt: Statement): void {
        switch (stmt.kind) {
            case 'block':
                stmt.statements.forEach((inner) => this.collect(inner));
                return;
            case 'var':
                if (this.slots.has(stmt.name)) {
                    throw new CompilerError(`duplicate local '${stmt.name}' in function '${this.functionName}'`);
                }
                this.nextOffset = alignTo(this.nextOffset, typeAlignmentBytes(stmt.type));
                const sizeBytes = typeSizeBytes(stmt.type);
                this.slots.set(stmt.name, { type: stmt.type, offset: this.nextOffset, sizeBytes });
                this.nextOffset += sizeBytes;
                if (stmt.init) this.collectInitializer(stmt.init);
                return;
            case 'expr':
                this.collectExpr(stmt.expr);
                return;
            case 'if':
                this.collectExpr(stmt.test);
                this.collect(stmt.thenBranch);
                if (stmt.elseBranch) this.collect(stmt.elseBranch);
                return;
            case 'while':
                this.collectExpr(stmt.test);
                this.collect(stmt.body);
                return;
            case 'for':
                if (stmt.init) {
                    if (isVarDecl(stmt.init)) this.collect(stmt.init);
                    else this.collectExpr(stmt.init);
                }
                if (stmt.test) this.collectExpr(stmt.test);
                if (stmt.step) this.collectExpr(stmt.step);
                this.collect(stmt.body);
                return;
            case 'return':
                if (stmt.expr) this.collectExpr(stmt.expr);
                return;
            case 'label':
                this.collect(stmt.statement);
                return;
            case 'break':
            case 'continue':
            case 'goto':
            case 'empty':
                return;
        }
    }

    private collectInitializer(init: Initializer): void {
        switch (init.kind) {
            case 'expr-init':
                this.collectExpr(init.expr);
                return;
            case 'list-init':
                init.values.forEach((value) => this.collectExpr(value));
                return;
        }
    }

    private collectExpr(expr: Expr): void {
        switch (expr.kind) {
            case 'assign':
                this.collectExpr(expr.target);
                this.collectExpr(expr.value);
                return;
            case 'compound-assign':
                this.collectExpr(expr.target);
                this.collectExpr(expr.value);
                return;
            case 'update':
                this.collectExpr(expr.target);
                return;
            case 'conditional':
                this.collectExpr(expr.test);
                this.collectExpr(expr.consequent);
                this.collectExpr(expr.alternate);
                return;
            case 'binary':
                this.collectExpr(expr.left);
                this.collectExpr(expr.right);
                return;
            case 'unary':
                this.collectExpr(expr.expr);
                return;
            case 'cast':
                this.collectExpr(expr.expr);
                return;
            case 'index':
                this.collectExpr(expr.target);
                this.collectExpr(expr.index);
                return;
            case 'call':
                this.maxCallArgs = Math.max(this.maxCallArgs, expr.args.length);
                expr.args.forEach((arg) => this.collectExpr(arg));
                return;
            case 'number':
            case 'string':
            case 'varref':
                return;
        }
    }
}

export function compileC(source: string, options: CompileOptions = {}): CompileResult {
    const tokens = new Lexer(source).tokenize();
    const program = new Parser(tokens).parseProgram();
    const assembly = new CodeGenerator(program, options).generate();
    return { assembly };
}

function normalizeArrayInitializer(type: CType, init?: Initializer): NormalizedArrayInitializer {
    if (!isArrayType(type) || type.arrayLength === null) {
        throw new CompilerError('internal error: expected complete array type');
    }
    if (!init) {
        return { kind: 'expr-elements', values: [], zeroFill: type.arrayLength };
    }

    switch (init.kind) {
        case 'list-init':
            return {
                kind: 'expr-elements',
                values: init.values,
                zeroFill: type.arrayLength - init.values.length,
            };
        case 'expr-init':
            if (init.expr.kind !== 'string') {
                throw new CompilerError('internal error: unsupported array expression initializer');
            }
            return {
                kind: 'byte-elements',
                values: [...init.expr.bytes, 0],
                zeroFill: type.arrayLength - init.expr.bytes.length - 1,
            };
    }
}

function isComparison(op: string): boolean {
    return ['==', '!=', '<', '<=', '>', '>='].includes(op);
}

function intType(): CType {
    return { base: 'int', pointerDepth: 0, volatile: false };
}

function uintType(): CType {
    return { base: 'uint', pointerDepth: 0, volatile: false };
}

function voidType(): CType {
    return { base: 'void', pointerDepth: 0, volatile: false };
}

function isVoidType(type: CType): boolean {
    return type.base === 'void' && type.pointerDepth === 0;
}

function isIntegerType(type: CType): boolean {
    return type.pointerDepth === 0 && type.base !== 'void' && !isArrayType(type);
}

function isScalarType(type: CType): boolean {
    return isIntegerType(type) || type.pointerDepth > 0;
}

function isArrayType(type: CType): type is CType & { arrayLength: number | null } {
    return type.arrayLength !== undefined;
}

function isUnsignedType(type: CType): boolean {
    return type.pointerDepth > 0 || type.base === 'uchar' || type.base === 'ushort' || type.base === 'uint';
}

function promoteIntegerType(type: CType): CType {
    if (type.pointerDepth > 0 || type.base === 'void') {
        return type;
    }
    if (type.base === 'char' || type.base === 'uchar' || type.base === 'short' || type.base === 'ushort') {
        return intType();
    }
    return type;
}

function usualArithmeticType(leftType: CType, rightType: CType): CType {
    const left = promoteIntegerType(leftType);
    const right = promoteIntegerType(rightType);
    return isUnsignedType(left) || isUnsignedType(right) ? uintType() : intType();
}

function pointerTo(type: CType): CType {
    return { base: type.base, pointerDepth: type.pointerDepth + 1, volatile: type.volatile };
}

function derefType(type: CType): CType {
    if (type.pointerDepth < 1) {
        throw new CompilerError('cannot dereference a non-pointer type');
    }
    return { base: type.base, pointerDepth: type.pointerDepth - 1, volatile: type.volatile };
}

function arrayDecayType(type: CType): CType {
    if (!isArrayType(type)) {
        return type;
    }
    return { base: type.base, pointerDepth: type.pointerDepth + 1, volatile: type.volatile };
}

function typeSizeBytes(type: CType): number {
    if (type.arrayLength === null) {
        throw new CompilerError('internal error: incomplete array has no size');
    }
    const elementCount = type.arrayLength ?? 1;
    if (type.pointerDepth > 0) {
        return elementCount * 4;
    }
    let elementSize: number;
    switch (type.base) {
        case 'char':
        case 'uchar':
            elementSize = 1;
            break;
        case 'short':
        case 'ushort':
            elementSize = 2;
            break;
        case 'int':
        case 'uint':
            elementSize = 4;
            break;
        case 'void':
            elementSize = 0;
            break;
    }
    return elementCount * elementSize;
}

function typeAlignmentBytes(type: CType): number {
    return Math.max(1, Math.min(4, typeSizeBytes(arrayElementType(type))));
}

function arrayElementType(type: CType): CType {
    const { arrayLength: _arrayLength, ...elementType } = type;
    return elementType;
}

function loadMnemonic(type: CType): string {
    if (type.pointerDepth > 0) return 'lw';
    switch (type.base) {
        case 'char': return 'lb';
        case 'uchar': return 'lbu';
        case 'short': return 'lh';
        case 'ushort': return 'lhu';
        case 'int':
        case 'uint': return 'lw';
        case 'void': throw new CompilerError('cannot load a void value');
    }
}

function storeMnemonic(type: CType): string {
    if (type.pointerDepth > 0) return 'sw';
    switch (type.base) {
        case 'char':
        case 'uchar': return 'sb';
        case 'short':
        case 'ushort': return 'sh';
        case 'int':
        case 'uint': return 'sw';
        case 'void': throw new CompilerError('cannot store a void value');
    }
}

function convertConstant(value: number, type: CType): number {
    if (type.pointerDepth > 0) return value >>> 0;
    switch (type.base) {
        case 'char': return (value << 24) >> 24;
        case 'uchar': return value & 0xff;
        case 'short': return (value << 16) >> 16;
        case 'ushort': return value & 0xffff;
        case 'int': return value | 0;
        case 'uint': return value >>> 0;
        case 'void': return value;
    }
}

function isVarDecl(value: VarDeclStmt | Expr): value is VarDeclStmt {
    return (value as VarDeclStmt).kind === 'var';
}

function last<T>(items: T[]): T | undefined {
    return items.length ? items[items.length - 1] : undefined;
}

function align4(value: number): number {
    return alignTo(value, 4);
}

function alignTo(value: number, alignment: number): number {
    return Math.ceil(value / alignment) * alignment;
}

function formatImm(value: number): string {
    const unsigned = value >>> 0;
    if (unsigned > 9 || unsigned < 0) {
        return `0x${unsigned.toString(16).toUpperCase()}`;
    }
    return String(unsigned);
}

function sanitizeIdentifier(name: string): string {
    const sanitized = name.replace(/[^A-Za-z0-9_]/g, '_');
    if (!/^[A-Za-z_]/.test(sanitized)) {
        return `_${sanitized}`;
    }
    return sanitized || 'merc32_c_program';
}
