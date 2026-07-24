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

type BaseType = 'int' | 'uint' | 'void';

interface CType {
    base: BaseType;
    pointerDepth: number;
    arrayLength?: number;
    volatile: boolean;
}

interface Token {
    kind: 'identifier' | 'number' | 'keyword' | 'symbol' | 'eof';
    text: string;
    value?: number;
    line: number;
    column: number;
}

interface Program {
    globals: GlobalDecl[];
    functions: FunctionDecl[];
}

interface GlobalDecl {
    kind: 'global';
    type: CType;
    name: string;
    init?: Expr;
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
    init?: Expr;
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
    | VarExpr
    | AssignExpr
    | BinaryExpr
    | UnaryExpr
    | CallExpr
    | CastExpr
    | IndexExpr;

interface NumberExpr {
    kind: 'number';
    value: number;
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
}

const KEYWORDS = new Set([
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

const TWO_CHAR_SYMBOLS = new Set(['==', '!=', '<=', '>=', '&&', '||', '<<', '>>']);
const ONE_CHAR_SYMBOLS = new Set(['+', '-', '*', '&', '|', '^', '~', '!', '=', '<', '>', ';', ',', '(', ')', '{', '}', '[', ']', ':']);

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
            const declaredType = this.parseDeclaratorSuffix(type);
            if (this.match('(')) {
                const params = this.parseParams();
                if (this.match(';')) {
                    if (declaredType.arrayLength !== undefined) {
                        throw this.error('function cannot return an array');
                    }
                    functions.push({ kind: 'function', returnType: declaredType, name, params });
                } else {
                    if (declaredType.arrayLength !== undefined) {
                        throw this.error('function cannot return an array');
                    }
                    functions.push({ kind: 'function', returnType: declaredType, name, params, body: this.parseBlock() });
                }
            } else {
                let init: Expr | undefined;
                if (this.match('=')) {
                    init = this.parseExpression();
                }
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
            if (declaredType.arrayLength !== undefined) {
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
        const declaredType = this.parseDeclaratorSuffix(type);
        const init = this.match('=') ? this.parseExpression() : undefined;
        if (expectSemicolon) {
            this.expect(';');
        }
        return { kind: 'var', type: declaredType, name, init };
    }

    private parseDeclaratorSuffix(type: CType): CType {
        if (!this.match('[')) {
            return type;
        }
        const sizeToken = this.current();
        if (sizeToken.kind !== 'number' || sizeToken.value === undefined || sizeToken.value <= 0) {
            throw this.error('array size must be a positive numeric constant');
        }
        this.advance();
        this.expect(']');
        if (type.pointerDepth > 0) {
            throw this.error('arrays of pointers are not supported yet');
        }
        if (isVoidType(type)) {
            throw this.error('array element type cannot be void');
        }
        return { ...type, arrayLength: sizeToken.value };
    }

    private parseExpression(): Expr {
        return this.parseAssignment();
    }

    private parseAssignment(): Expr {
        const left = this.parseLogicalOr();
        if (this.match('=')) {
            if (!this.isAssignable(left)) {
                throw this.error('left side of assignment must be a variable or dereference');
            }
            return { kind: 'assign', target: left, value: this.parseAssignment() };
        }
        return left;
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
        return this.parseBinary(() => this.parseUnary(), ['+', '-']);
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
        return expr;
    }

    private parsePrimary(): Expr {
        if (this.match('(')) {
            if (this.isTypeStart()) {
                const type = this.parseType();
                this.expect(')');
                return { kind: 'cast', type, expr: this.parseUnary() };
            }
            const expr = this.parseExpression();
            this.expect(')');
            return expr;
        }
        if (this.current().kind === 'number') {
            const token = this.advance();
            return { kind: 'number', value: token.value || 0 };
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
            this.expectKeyword('int');
            base = 'uint';
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
        return this.isKeyword('int') || this.isKeyword('unsigned') || this.isKeyword('void') || this.isKeyword('volatile');
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

class CodeGenerator {
    private readonly lines: string[] = [];
    private readonly globals = new Map<string, Slot>();
    private readonly functionMap = new Map<string, FunctionDecl>();
    private readonly dataBase: number;
    private readonly dlbAddrWidth: number;
    private readonly moduleName: string;
    private readonly tempSlots: number;
    private nextGlobalAddress: number;
    private current?: FunctionContext;

    constructor(private readonly program: Program, options: CompileOptions) {
        this.dataBase = options.dataBase ?? 0x0080_0000;
        this.dlbAddrWidth = options.dlbAddrWidth ?? 16;
        this.moduleName = sanitizeIdentifier(options.moduleName || 'merc32_c_program');
        this.tempSlots = options.tempSlots ?? 32;
        this.nextGlobalAddress = this.dataBase;
    }

    generate(): string {
        this.indexProgram();

        this.emit(`.prog ${this.moduleName}`);
        this.emit('.entry __start');
        this.emit('');
        this.emit('__start:');
        this.loadImm('r13', this.dataBase + (1 << (this.dlbAddrWidth + 2)));
        this.emitGlobalInitializers();
        this.emit('jmp main, r14');
        this.emit('__halt:');
        this.emit('jmp __halt');
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
        for (const global of this.program.globals) {
            if (this.globals.has(global.name)) {
                throw new CompilerError(`duplicate global '${global.name}'`);
            }
            if (isVoidType(global.type)) {
                throw new CompilerError(`global '${global.name}' cannot have void type`);
            }
            this.globals.set(global.name, {
                type: global.type,
                globalAddress: this.nextGlobalAddress,
                sizeBytes: typeSizeBytes(global.type),
            });
            this.nextGlobalAddress += typeSizeBytes(global.type);
        }

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
    }

    private emitGlobalInitializers(): void {
        for (const global of this.program.globals) {
            const slot = this.globals.get(global.name);
            if (slot?.globalAddress === undefined) {
                throw new CompilerError(`internal error: missing global '${global.name}'`);
            }
            if (global.type.arrayLength !== undefined) {
                if (global.init) {
                    throw new CompilerError('array initializers are not supported yet');
                }
                this.loadImm('r7', 0);
                for (let offset = 0; offset < slot.sizeBytes; offset += 4) {
                    this.loadImm('r8', slot.globalAddress + offset);
                    this.emit('mov [r8], r7');
                }
                continue;
            }
            const value = global.init ? this.evalConstant(global.init) : 0;
            this.loadImm('r7', value);
            this.loadImm('r8', slot.globalAddress);
            this.emit('mov [r8], r7');
        }
    }

    private evalConstant(expr: Expr): number {
        switch (expr.kind) {
            case 'number':
                return expr.value;
            case 'unary': {
                const value = this.evalConstant(expr.expr);
                if (expr.op === '-') return -value;
                if (expr.op === '~') return ~value;
                if (expr.op === '!') return value ? 0 : 1;
                if (expr.op === '+') return value;
                break;
            }
            case 'cast':
                return this.evalConstant(expr.expr);
            case 'binary': {
                const left = this.evalConstant(expr.left);
                const right = this.evalConstant(expr.right);
                switch (expr.op) {
                    case '+': return left + right;
                    case '-': return left - right;
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
        }
        throw new CompilerError('global initializer must be a constant expression');
    }

    private emitFunction(fn: FunctionDecl): void {
        if (!fn.body) {
            return;
        }

        const layout = this.buildLayout(fn);
        const ctx: FunctionContext = {
            fn,
            layout,
            returnLabel: `__${fn.name}_return`,
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
        this.emit('mov r12, r13');

        fn.params.forEach((param, index) => {
            const slot = layout.slots.get(param.name);
            if (!slot?.offset) {
                throw new CompilerError(`internal error: missing parameter '${param.name}'`);
            }
            if (index < 4) {
                this.emit(`mov [r12 + ${slot.offset}], ${ABI_ARG_REGS[index]}`);
            } else {
                const sourceOffset = layout.frameSize + (index - 4) * 4;
                this.emit(`mov r7, [r12 + ${sourceOffset}]`);
                this.emit(`mov [r12 + ${slot.offset}], r7`);
            }
        });

        this.emitStatement(fn.body);
        if (isVoidType(fn.returnType)) {
            this.loadImm(ABI_RETURN_REG, 0);
        }
        this.emit(`jmp ${ctx.returnLabel}`);

        this.emit(`${ctx.returnLabel}:`);
        this.emit('mov r14, [r12 + 0]');
        this.emit('mov r8, [r12 + 4]');
        this.emit(`mov r13, r12 + ${layout.frameSize}`);
        this.emit('mov r12, r8');
        this.emit('jmp r14');
        this.current = undefined;
    }

    private buildLayout(fn: FunctionDecl): FunctionLayout {
        if (!fn.body) {
            throw new CompilerError(`function '${fn.name}' has no body`);
        }

        const slots = new Map<string, Slot>();
        let offset = 8;
        for (const param of fn.params) {
            if (slots.has(param.name)) {
                throw new CompilerError(`duplicate parameter '${param.name}' in function '${fn.name}'`);
            }
            slots.set(param.name, { type: param.type, offset, sizeBytes: 4 });
            offset += 4;
        }

        const collector = new FunctionCollector(fn.name, slots);
        collector.collect(fn.body);
        offset = collector.nextOffset;
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
                    this.emitExpr(stmt.init, 'r7');
                    this.storeVar(stmt.name, 'r7');
                }
                return;
            case 'expr':
                this.emitExpr(stmt.expr, 'r7');
                return;
            case 'return':
                if (stmt.expr) {
                    this.emitExpr(stmt.expr, ABI_RETURN_REG);
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

    private emitExpr(expr: Expr, target: string): CType {
        switch (expr.kind) {
            case 'number':
                this.loadImm(target, expr.value);
                return intType();
            case 'varref':
                if (this.lookupVar(expr.name).type.arrayLength !== undefined) {
                    this.emitAddress(expr, target);
                    return arrayDecayType(this.lookupVar(expr.name).type);
                }
                this.loadVar(expr.name, target);
                return this.lookupVar(expr.name).type;
            case 'assign': {
                const type = this.emitExpr(expr.value, target);
                this.storeLValue(expr.target, target);
                return type;
            }
            case 'unary':
                return this.emitUnary(expr, target);
            case 'binary':
                return this.emitBinary(expr, target);
            case 'call':
                return this.emitCall(expr, target);
            case 'cast':
                this.emitExpr(expr.expr, target);
                return expr.type;
            case 'index': {
                const elementType = this.indexElementType(expr);
                this.emitIndexAddress(expr, 'r8');
                this.emit(`mov ${target}, [r8]`);
                return elementType;
            }
        }
    }

    private emitUnary(expr: UnaryExpr, target: string): CType {
        if (expr.op === '&') {
            this.emitAddress(expr.expr, target);
            return pointerTo(this.lvalueType(expr.expr));
        }
        if (expr.op === '*') {
            const pointerType = this.emitExpr(expr.expr, 'r8');
            if (pointerType.pointerDepth < 1) {
                throw new CompilerError('cannot dereference a non-pointer expression');
            }
            this.emit(`mov ${target}, [r8]`);
            return derefType(pointerType);
        }

        const type = this.emitExpr(expr.expr, target);
        if (expr.op === '-') {
            this.emit(`mov ${target}, r0 - ${target}`);
            return type;
        }
        if (expr.op === '~') {
            this.loadImm('r8', -1);
            this.emit(`mov ${target}, ${target} ^ r8`);
            return type;
        }
        if (expr.op === '!') {
            const trueLabel = this.newLabel('not_true');
            const endLabel = this.newLabel('not_end');
            this.emit(`cmp ${target}, 0`);
            this.loadImm(target, 0);
            this.emit(`brc ${trueLabel}, "=="`);
            this.emit(`jmp ${endLabel}`);
            this.emit(`${trueLabel}:`);
            this.loadImm(target, 1);
            this.emit(`${endLabel}:`);
            return intType();
        }
        throw new CompilerError(`unsupported unary operator '${expr.op}'`);
    }

    private emitBinary(expr: BinaryExpr, target: string): CType {
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
        const resultType = this.binaryResultType(expr.op, leftType, rightType);
        this.scalePointerOperand(expr.op, leftType, rightType);

        switch (expr.op) {
            case '+':
                this.emit(`mov ${target}, r7 + r8`);
                break;
            case '-':
                this.emit(`mov ${target}, r7 - r8`);
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
                this.emit(`mov ${target}, r7 ${isUnsignedType(leftType) ? '>>' : '>>>'} r8`);
                break;
            default:
                throw new CompilerError(`unsupported binary operator '${expr.op}'`);
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
        const trueLabel = this.newLabel('cmp_true');
        const endLabel = this.newLabel('cmp_end');
        const cond = expr.op;
        const unsigned = this.shouldUseUnsignedCompare(expr.left, expr.right);
        const temp = this.allocTemp();
        this.emitExpr(expr.left, 'r7');
        this.storeTemp(temp, 'r7');
        this.emitExpr(expr.right, 'r8');
        this.loadTemp(temp, 'r7');
        this.freeTemp();
        this.emit('cmp r7, r8');
        this.loadImm(target, 0);
        this.emit(`${unsigned ? 'brcu' : 'brc'} ${trueLabel}, "${cond}"`);
        this.emit(`jmp ${endLabel}`);
        this.emit(`${trueLabel}:`);
        this.loadImm(target, 1);
        this.emit(`${endLabel}:`);
        return intType();
    }

    private emitCall(expr: CallExpr, target: string): CType {
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
            if (target !== 'r8') {
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
        if (target !== ABI_RETURN_REG) {
            this.emit(`mov ${target}, ${ABI_RETURN_REG}`);
        }
        for (let i = 0; i < argTemps.length; i++) {
            this.freeTemp();
        }
        return fn.returnType;
    }

    private emitBranchIfFalse(expr: Expr, label: string): void {
        this.emitExpr(expr, 'r7');
        this.emit('cmp r7, 0');
        this.emit(`brc ${label}, "=="`);
    }

    private emitBranchIfTrue(expr: Expr, label: string): void {
        this.emitExpr(expr, 'r7');
        this.emit('cmp r7, 0');
        this.emit(`brc ${label}, "!="`);
    }

    private loadVar(name: string, target: string): void {
        const slot = this.lookupVar(name);
        if (slot.globalAddress !== undefined) {
            this.loadImm('r8', slot.globalAddress);
            this.emit(`mov ${target}, [r8]`);
            return;
        }
        if (slot.offset === undefined) {
            throw new CompilerError(`internal error: missing offset for '${name}'`);
        }
        this.emit(`mov ${target}, [r12 + ${slot.offset}]`);
    }

    private storeVar(name: string, source: string): void {
        const slot = this.lookupVar(name);
        if (slot.globalAddress !== undefined) {
            this.loadImm('r8', slot.globalAddress);
            this.emit(`mov [r8], ${source}`);
            return;
        }
        if (slot.offset === undefined) {
            throw new CompilerError(`internal error: missing offset for '${name}'`);
        }
        this.emit(`mov [r12 + ${slot.offset}], ${source}`);
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
            this.loadTemp(temp, source);
            this.freeTemp();
            this.emit(`mov [r8], ${source}`);
            return;
        }
        if (targetExpr.kind === 'index') {
            const temp = this.allocTemp();
            this.storeTemp(temp, source);
            this.emitIndexAddress(targetExpr, 'r8');
            this.loadTemp(temp, source);
            this.freeTemp();
            this.emit(`mov [r8], ${source}`);
            return;
        }
        throw new CompilerError('unsupported assignment target');
    }

    private emitAddress(expr: Expr, target: string): void {
        if (expr.kind === 'varref') {
            const slot = this.lookupVar(expr.name);
            if (slot.globalAddress !== undefined) {
                this.loadImm(target, slot.globalAddress);
                return;
            }
            if (slot.offset === undefined) {
                throw new CompilerError(`internal error: missing offset for '${expr.name}'`);
            }
            this.emit(`mov ${target}, r12 + ${slot.offset}`);
            return;
        }
        if (expr.kind === 'index') {
            this.emitIndexAddress(expr, target);
            return;
        }
        if (expr.kind === 'unary' && expr.op === '*') {
            this.emitExpr(expr.expr, target);
            return;
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
            case 'varref':
                return arrayDecayType(this.lookupVar(expr.name).type);
            case 'assign':
                return this.lvalueType(expr.target);
            case 'index':
                return this.indexElementType(expr);
            case 'unary':
                if (expr.op === '!') return intType();
                if (expr.op === '&') return pointerTo(this.lvalueType(expr.expr));
                if (expr.op === '*') return derefType(this.exprType(expr.expr));
                return this.exprType(expr.expr);
            case 'binary':
                if (isComparison(expr.op) || expr.op === '&&' || expr.op === '||') return intType();
                return this.binaryResultType(expr.op, this.exprType(expr.left), this.exprType(expr.right));
            case 'call':
                if (expr.name === '__load32' || expr.name === '__store32') return uintType();
                return this.functionMap.get(expr.name)?.returnType || intType();
            case 'cast':
                return expr.type;
        }
    }

    private binaryResultType(op: string, leftType: CType, rightType: CType): CType {
        if (['+', '-'].includes(op)) {
            if (leftType.pointerDepth > 0 && rightType.pointerDepth === 0) return leftType;
            if (op === '+' && rightType.pointerDepth > 0 && leftType.pointerDepth === 0) return rightType;
        }
        if (leftType.pointerDepth > 0 || rightType.pointerDepth > 0) {
            return uintType();
        }
        return isUnsignedType(leftType) || isUnsignedType(rightType) ? uintType() : intType();
    }

    private scalePointerOperand(op: string, leftType: CType, rightType: CType): void {
        if (!['+', '-'].includes(op)) {
            return;
        }
        if (leftType.pointerDepth > 0 && rightType.pointerDepth === 0) {
            this.emit('mov r8, r8 << 2');
            return;
        }
        if (op === '+' && rightType.pointerDepth > 0 && leftType.pointerDepth === 0) {
            this.emit('mov r7, r7 << 2');
        }
    }

    private shouldUseUnsignedCompare(left: Expr, right: Expr): boolean {
        const leftType = this.exprType(left);
        const rightType = this.exprType(right);
        return leftType.pointerDepth > 0 || rightType.pointerDepth > 0 || isUnsignedType(leftType) || isUnsignedType(rightType);
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
        this.emit('mov r8, r8 << 2');
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
        return `__${ctx.fn.name}_${prefix}_${ctx.labelId++}`;
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
    ) {
        let maxOffset = 8;
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
                if (stmt.type.arrayLength !== undefined && stmt.init) {
                    throw new CompilerError('array initializers are not supported yet');
                }
                const sizeBytes = typeSizeBytes(stmt.type);
                this.slots.set(stmt.name, { type: stmt.type, offset: this.nextOffset, sizeBytes });
                this.nextOffset += sizeBytes;
                if (stmt.init) this.collectExpr(stmt.init);
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

    private collectExpr(expr: Expr): void {
        switch (expr.kind) {
            case 'assign':
                this.collectExpr(expr.target);
                this.collectExpr(expr.value);
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

function isComparison(op: string): boolean {
    return ['==', '!=', '<', '<=', '>', '>='].includes(op);
}

function intType(): CType {
    return { base: 'int', pointerDepth: 0, volatile: false };
}

function uintType(): CType {
    return { base: 'uint', pointerDepth: 0, volatile: false };
}

function isVoidType(type: CType): boolean {
    return type.base === 'void' && type.pointerDepth === 0;
}

function isUnsignedType(type: CType): boolean {
    return type.base === 'uint' || type.pointerDepth > 0;
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
    if (type.arrayLength === undefined) {
        return type;
    }
    return { base: type.base, pointerDepth: type.pointerDepth + 1, volatile: type.volatile };
}

function typeSizeBytes(type: CType): number {
    return (type.arrayLength ?? 1) * 4;
}

function isVarDecl(value: VarDeclStmt | Expr): value is VarDeclStmt {
    return (value as VarDeclStmt).kind === 'var';
}

function last<T>(items: T[]): T | undefined {
    return items.length ? items[items.length - 1] : undefined;
}

function align4(value: number): number {
    return (value + 3) & ~3;
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
