import { Relocation } from '../linker/objectFormat';
import { IRBlock, IRFunction, IRGlobal, IRInstruction, Merc32Module } from './ir';
import { CType, pointerType, typeAlignment, typeSize } from './types';
import { LoweringExpression, LoweringFunction, LoweringGlobal, LoweringProgram, LoweringStatement } from './loweringModel';
import { lowerProgram as lowerLegacyProgram } from './legacyLower';

export function lowerProgram(program: LoweringProgram): Merc32Module;
export function lowerProgram(program: unknown): Merc32Module;
export function lowerProgram(program: unknown): Merc32Module {
    if (isLoweringProgram(program)) return lowerTypedProgram(program);
    return lowerLegacyProgram(program as never);
}

function isLoweringProgram(value: unknown): value is LoweringProgram {
    return !!value && typeof value === 'object' && (value as { abi?: unknown }).abi === 'merc32-c-v1'
        && Array.isArray((value as { functions?: unknown }).functions);
}

function lowerTypedProgram(program: LoweringProgram): Merc32Module {
    const globals = program.globals.map(lowerGlobal);
    const functions = program.functions.map((func) => lowerFunction(func));
    if ([...globals, ...functions].some((item) => item.name === '__merc32_init_globals')) {
        throw new Error("reserved compiler symbol '__merc32_init_globals' is already defined");
    }
    functions.push(createGlobalInitializer('__merc32_init_globals', globals));
    return { abi: program.abi, functions, globals };
}

function lowerGlobal(global: LoweringGlobal): IRGlobal {
    if (!global.initializer) return { name: global.name, type: global.type };
    const bytes = new Uint8Array(global.initializer.size);
    const relocations: Relocation[] = [];
    for (const write of global.initializer.writes) {
        const size = typeSize(write.type);
        if (write.offset < 0 || write.offset + size > bytes.length) throw new Error(`initializer write for '${global.name}' is out of bounds`);
        if (typeof write.value === 'bigint') {
            if (![1, 2, 4].includes(size)) throw new Error(`initializer does not support ${size}-byte integer values`);
            let value = write.value; const modulus = 1n << BigInt(size * 8); if (value < 0) value = (value + modulus) % modulus;
            for (let i = 0; i < size; i++) bytes[write.offset + i] = Number((value >> BigInt(i * 8)) & 0xffn);
        } else if ('symbol' in write.value) {
            if (size !== 4) throw new Error(`address initializer requires a 4-byte pointer, got ${size}`);
            relocations.push({ section: 'data', offset: write.offset, kind: 'ABS32', symbol: write.value.symbol, addend: Number(write.value.addend), debug: write.location });
        } else {
            if (write.offset + write.value.bytes.length > bytes.length) throw new Error(`string initializer for '${global.name}' is out of bounds`);
            write.value.bytes.forEach((value, index) => { bytes[write.offset + index] = value; });
        }
    }
    return { name: global.name, type: global.type, initializerBytes: [...bytes], initializerRelocations: relocations };
}

function createGlobalInitializer(name: string, globals: readonly IRGlobal[]): IRFunction {
    const instructions: IRInstruction[] = []; let nextValue = 0;
    for (const global of globals) {
        const base = nextValue++; instructions.push({ op: 'address-symbol', args: [global.name], dest: base });
        const bytes = global.initializerBytes ?? global.initializer ?? Array.from({ length: typeSize(global.type) }, () => 0);
        bytes.forEach((byte, offset) => {
            if ((global.initializerRelocations ?? []).some((relocation) => offset >= relocation.offset && offset < relocation.offset + 4)) return;
            let address = base;
            if (offset !== 0) { const off = nextValue++; instructions.push({ op: 'constant', args: [offset], dest: off }); address = nextValue++; instructions.push({ op: 'binary', args: ['+', base, off], dest: address }); }
            const value = nextValue++; instructions.push({ op: 'constant', args: [byte], dest: value }, { op: 'store-memory', args: [address, value, 1] });
        });
    }
    const zero = nextValue++; instructions.push({ op: 'constant', args: [0], dest: zero }, { op: 'ret', args: [zero] });
    return { name, parameters: [], parameterNames: [], localNames: [], localTypes: [], blocks: [{ label: `${name}.entry`, instructions }] };
}

function lowerFunction(func: LoweringFunction): IRFunction {
    const lowerer = new FunctionLowerer(func);
    lowerer.lowerStatement(func.body);
    if (lowerer.instructions.length === 0 || lowerer.instructions[lowerer.instructions.length - 1].op !== 'ret') lowerer.instructions.push({ op: 'ret', args: [lowerer.constant(0)] });
    return { name: func.name, returnType: func.returnType, parameters: func.parameters, parameterNames: func.parameterNames, localNames: lowerer.localNames, localTypes: lowerer.localTypes, returnLabel: lowerer.returnLabel(), blocks: [{ label: `${func.name}.entry`, instructions: lowerer.instructions }] };
}

class FunctionLowerer {
    readonly instructions: IRInstruction[] = [];
    readonly localNames: string[] = [];
    readonly localTypes: CType[] = [];
    private nextValue = 0;
    private nextLabel = 0;
    private readonly breakLabels: string[] = [];
    private readonly continueLabels: string[] = [];
    private readonly switchCases: Array<Map<LoweringStatement, string>> = [];
    private readonly userLabels = new Map<string, string>();
    private readonly labels = new Set<string>();
    private readonly variables = new Map<string, CType>();
    public constructor(private readonly func: LoweringFunction) {
        func.parameterNames.forEach((name, index) => { if (name) this.variables.set(name, func.parameters[index]); });
    }
    public lowerStatement(statement: LoweringStatement): void {
        switch (statement.kind) {
            case 'compound': statement.statements.forEach((child) => this.lowerStatement(child)); return;
            case 'declaration': { const binding = statement.binding ?? statement.name; this.localNames.push(binding); this.localTypes.push(statement.type); this.variables.set(binding, statement.type); if (statement.initializer && !('size' in statement.initializer)) this.instructions.push({ op: 'store', args: [binding, this.lowerExpression(statement.initializer)], location: statement.location }); return; }
            case 'expression': this.lowerExpression(statement.expression); return;
            case 'return': this.instructions.push({ op: 'ret', args: [statement.expression ? this.lowerExpression(statement.expression) : this.constant(0)], location: statement.location }); return;
            case 'if': { const other = this.label('else'); const end = this.label('endif'); const test = this.lowerExpression(statement.test); this.instructions.push({ op: 'branch-zero', args: [test, other], location: statement.location }); this.lowerStatement(statement.thenBranch); this.instructions.push({ op: 'jump', args: [end] }, { op: 'label', args: [other] }); if (statement.elseBranch) this.lowerStatement(statement.elseBranch); this.instructions.push({ op: 'label', args: [end] }); return; }
            case 'while': { const start = this.label('while'); const end = this.label('endwhile'); this.instructions.push({ op: 'label', args: [start] }); const test = this.lowerExpression(statement.test); this.instructions.push({ op: 'branch-zero', args: [test, end] }); this.breakLabels.push(end); this.continueLabels.push(start); this.lowerStatement(statement.body); this.continueLabels.pop(); this.breakLabels.pop(); this.instructions.push({ op: 'jump', args: [start] }, { op: 'label', args: [end] }); return; }
            case 'do-while': { const body = this.label('do_body'); const condition = this.label('do_condition'); const end = this.label('enddo'); this.instructions.push({ op: 'label', args: [body] }); this.breakLabels.push(end); this.continueLabels.push(condition); this.lowerStatement(statement.body); this.continueLabels.pop(); this.breakLabels.pop(); this.instructions.push({ op: 'label', args: [condition] }); const test = this.lowerExpression(statement.test); this.instructions.push({ op: 'branch-nonzero', args: [test, body] }, { op: 'label', args: [end] }); return; }
            case 'for': { if (statement.init) isStatement(statement.init) ? this.lowerStatement(statement.init) : this.lowerExpression(statement.init); const start = this.label('for'); const step = this.label('for_step'); const end = this.label('endfor'); this.instructions.push({ op: 'label', args: [start] }); if (statement.test) { const test = this.lowerExpression(statement.test); this.instructions.push({ op: 'branch-zero', args: [test, end] }); } this.breakLabels.push(end); this.continueLabels.push(step); this.lowerStatement(statement.body); this.continueLabels.pop(); this.breakLabels.pop(); this.instructions.push({ op: 'label', args: [step] }); if (statement.step) this.lowerExpression(statement.step); this.instructions.push({ op: 'jump', args: [start] }, { op: 'label', args: [end] }); return; }
            case 'switch': { const end = this.label('switch_end'); const entries = collectCases(statement.body, (prefix) => this.label(prefix)); const labels = new Map(entries.map((entry) => [entry.statement, entry.label])); const test = this.lowerExpression(statement.test); entries.filter((entry) => entry.statement.kind === 'case').forEach((entry) => { const value = this.constant(Number((entry.statement as Extract<LoweringStatement, { kind: 'case' }>).value)); const match = this.allocateValue(); this.instructions.push({ op: 'binary', args: ['==', test, value], dest: match }, { op: 'branch-nonzero', args: [match, entry.label] }); }); this.instructions.push({ op: 'jump', args: [entries.find((entry) => entry.statement.kind === 'default')?.label ?? end] }); this.breakLabels.push(end); this.switchCases.push(labels); this.lowerStatement(statement.body); this.switchCases.pop(); this.breakLabels.pop(); this.instructions.push({ op: 'label', args: [end] }); return; }
            case 'case': case 'default': { const label = this.switchCases[this.switchCases.length - 1]?.get(statement); if (!label) throw new Error('case/default label used outside switch'); this.instructions.push({ op: 'label', args: [label] }); this.lowerStatement(statement.statement); return; }
            case 'goto': this.instructions.push({ op: 'jump', args: [this.userLabel(statement.label)], location: statement.location }); return;
            case 'label': this.instructions.push({ op: 'label', args: [this.userLabel(statement.label)], location: statement.location }); this.lowerStatement(statement.statement!); return;
            case 'break': { const target = this.breakLabels[this.breakLabels.length - 1]; if (!target) throw new Error('break used outside loop or switch'); this.instructions.push({ op: 'jump', args: [target] }); return; }
            case 'continue': { const target = this.continueLabels[this.continueLabels.length - 1]; if (!target) throw new Error('continue used outside loop'); this.instructions.push({ op: 'jump', args: [target] }); return; }
            case 'empty': return;
        }
    }
    private lowerExpression(expression: LoweringExpression): number {
        if (expression.constant !== undefined) { if (typeof expression.constant === 'bigint') return this.constant(Number(expression.constant), expression.location); if ('symbol' in expression.constant) { const address = this.addressSymbol(expression.constant.symbol); if (expression.constant.addend !== 0n) return this.addAddressOffset(address, this.constant(Number(expression.constant.addend), expression.location), expression.location); return address; } throw new Error('string expression constants are not scalar values'); }
        switch (expression.kind) {
            case 'declaration-reference': case 'identifier': { const baseType = unwrapType(expression.type); if (expression.valueCategory === 'function' || baseType.kind === 'function' || baseType.kind === 'array') return this.lowerLValueAddress(expression); if (expression.constant !== undefined) return this.lowerExpression({ ...expression, kind: 'integer-literal' }); return this.loadLValue(expression); }
            case 'conversion': { const value = this.lowerExpression(expression.operands[0]); if (expression.conversion === 'pointer-to-bool' || expression.conversion === 'int-to-bool') { const result = this.allocateValue(); this.instructions.push({ op: 'binary', args: ['!=', value, this.constant(0, expression.location)], dest: result, location: expression.location }); return result; } return value; }
            case 'unary': if (expression.operator === '&') return this.lowerLValueAddress(expression.operands[0]); if (expression.operator === '*') return this.loadLValue(expression); { const value = this.lowerExpression(expression.operands[0]); if (expression.operator === '+') return value; const result = this.allocateValue(); const operator = expression.operator === '-' ? '-' : expression.operator === '!' ? '==' : '^'; const right = expression.operator === '~' ? this.constant(-1, expression.location) : expression.operator === '!' ? this.constant(0, expression.location) : value; const left = expression.operator === '-' ? this.constant(0, expression.location) : value; this.instructions.push({ op: 'binary', args: [operator, left, right], dest: result, location: expression.location }); return result; }
            case 'binary': if (expression.operator === '&&' || expression.operator === '||') return this.lowerLogical(expression); { let left = this.lowerExpression(expression.operands[0]); let right = this.lowerExpression(expression.operands[1]); const leftType = decay(expression.operands[0].type); const rightType = decay(expression.operands[1].type); if ((expression.operator === '+' || expression.operator === '-') && leftType.kind === 'pointer') right = this.scalePointerOffset(right, typeSize(leftType.pointee), expression.location); else if (expression.operator === '+' && rightType.kind === 'pointer') left = this.scalePointerOffset(left, typeSize(rightType.pointee), expression.location); if (expression.operator === '-' && leftType.kind === 'pointer' && rightType.kind === 'pointer') { const difference = this.allocateValue(); this.instructions.push({ op: 'binary', args: ['-', left, right], dest: difference, location: expression.location }); const size = typeSize(leftType.pointee); if (size !== 1) return this.divideBy(difference, size, expression.location); return difference; } const result = this.allocateValue(); this.instructions.push({ op: 'binary', args: [expression.operator ?? '', left, right], dest: result, location: expression.location }); return result; }
            case 'assignment': { const value = this.lowerExpression(expression.operands[1]); const target = expression.operands[0]; const binding = target.binding ?? target.symbol; if (binding && this.variables.has(binding)) this.instructions.push({ op: 'store', args: [binding, value], location: expression.location }); else this.instructions.push({ op: 'store-memory', args: [this.lowerLValueAddress(target), value, typeSize(target.type)], location: expression.location }); return value; }
            case 'call': { const callee = expression.operands[0]; const args = expression.operands.slice(1).map((operand) => this.lowerExpression(operand)); const dest = this.allocateValue(); if (callee.symbol) this.instructions.push({ op: 'call', args: [callee.symbol, ...args], dest, location: expression.location }); else this.instructions.push({ op: 'call-indirect', args: [this.lowerExpression(callee), ...args], dest, location: expression.location }); return dest; }
            case 'subscript': case 'member': return this.loadLValue(expression);
            case 'sizeof': case 'alignof': return this.constant(Number(expression.constant ?? 0n), expression.location);
            default: throw new Error(`typed lowering does not support '${expression.kind}'`);
        }
    }
    private loadLValue(expression: LoweringExpression): number { const result = this.allocateValue(); const type = expression.type; const size = typeSize(type); this.instructions.push({ op: 'load-memory', args: [this.lowerLValueAddress(expression), size, isSigned(type) ? 1 : 0], dest: result, location: expression.location }); return result; }
    private lowerLValueAddress(expression: LoweringExpression): number { if (expression.kind === 'declaration-reference' || expression.kind === 'identifier') { const binding = expression.binding ?? expression.symbol; return binding && this.variables.has(binding) ? this.addressLocal(binding) : this.addressSymbol(expression.symbol ?? ''); } if (expression.kind === 'unary' && expression.operator === '*') return this.lowerExpression(expression.operands[0]); if (expression.kind === 'subscript') { const element = expression.type; return this.addAddressOffset(this.lowerExpression(expression.operands[0]), this.scalePointerOffset(this.lowerExpression(expression.operands[1]), typeSize(element), expression.location), expression.location); } if (expression.kind === 'member') { const baseType = unwrapType(expression.operands[0].type); const base = baseType.kind === 'pointer' ? this.lowerExpression(expression.operands[0]) : this.lowerLValueAddress(expression.operands[0]); return expression.memberOffset ? this.addAddressOffset(base, this.constant(expression.memberOffset, expression.location), expression.location) : base; } throw new Error(`typed lowering cannot take the address of '${expression.kind}'`); }
    private addressLocal(name: string): number { const result = this.allocateValue(); this.instructions.push({ op: 'address-local', args: [name], dest: result }); return result; }
    private addressSymbol(name: string): number { const result = this.allocateValue(); this.instructions.push({ op: 'address-symbol', args: [name], dest: result }); return result; }
    private addAddressOffset(base: number, offset: number, location: IRInstruction['location']): number { const result = this.allocateValue(); this.instructions.push({ op: 'binary', args: ['+', base, offset], dest: result, location }); return result; }
    private scalePointerOffset(value: number, size: number, location: IRInstruction['location']): number { if (size === 1) return value; const scale = this.constant(size, location); const result = this.allocateValue(); this.instructions.push({ op: 'binary', args: ['*', value, scale], dest: result, location }); return result; }
    private divideBy(value: number, size: number, location: IRInstruction['location']): number { if (size === 1) return value; const scale = this.constant(size, location); const result = this.allocateValue(); this.instructions.push({ op: 'binary', args: ['/', value, scale], dest: result, location }); return result; }
    private lowerLogical(expression: LoweringExpression): number { const result = this.allocateValue(); const yes = this.label('logic_true'); const no = this.label('logic_false'); const end = this.label('logic_end'); const left = this.lowerExpression(expression.operands[0]); if (expression.operator === '&&') { this.instructions.push({ op: 'branch-zero', args: [left, no] }); const right = this.lowerExpression(expression.operands[1]); this.instructions.push({ op: 'branch-zero', args: [right, no] }, { op: 'jump', args: [yes] }); } else { this.instructions.push({ op: 'branch-nonzero', args: [left, yes] }); const right = this.lowerExpression(expression.operands[1]); this.instructions.push({ op: 'branch-nonzero', args: [right, yes] }, { op: 'jump', args: [no] }); } this.instructions.push({ op: 'label', args: [yes] }, { op: 'constant', args: [1], dest: result }, { op: 'jump', args: [end] }, { op: 'label', args: [no] }, { op: 'constant', args: [0], dest: result }, { op: 'label', args: [end] }); return result; }
    public returnLabel(): string { return this.label('return'); }
    private label(prefix: string): string { let candidate = `__${this.func.name}_${prefix}_${this.nextLabel++}`; while (this.labels.has(candidate)) candidate = `__${this.func.name}_${prefix}_${this.nextLabel++}`; this.labels.add(candidate); return candidate; }
    private allocateValue(): number { return this.nextValue++; }
    public constant(value: number, location?: IRInstruction['location']): number { const dest = this.allocateValue(); this.instructions.push({ op: 'constant', args: [value], dest, location }); return dest; }
    private userLabel(label: string): string { const existing = this.userLabels.get(label); if (existing) return existing; let generated = `__${this.func.name}_user_${label}`; let serial = 0; while (this.labels.has(generated)) generated = `__${this.func.name}_user_${label}_${serial++}`; this.labels.add(generated); this.userLabels.set(label, generated); return generated; }
}

function isStatement(value: LoweringExpression | LoweringStatement): value is LoweringStatement {
    return ['compound', 'declaration', 'expression', 'return', 'if', 'while', 'do-while', 'for', 'switch', 'case', 'default', 'break', 'continue', 'goto', 'label', 'empty'].includes(value.kind);
}
function collectCases(statement: LoweringStatement, makeLabel: (prefix: string) => string): Array<{ statement: LoweringStatement; label: string }> { const entries: Array<{ statement: LoweringStatement; label: string }> = []; const visit = (current: LoweringStatement): void => { if (current.kind === 'compound') current.statements.forEach(visit); else if (current.kind === 'case' || current.kind === 'default') { entries.push({ statement: current, label: makeLabel(current.kind) }); visit(current.statement); } else if (current.kind === 'if') { visit(current.thenBranch); if (current.elseBranch) visit(current.elseBranch); } else if ('body' in current && current.body) visit(current.body); }; visit(statement); return entries; }
function isSigned(type: CType): boolean { const unwrapped = unwrapType(type); return unwrapped.kind === 'builtin' && ['_Bool', 'char', 'signed char', 'short', 'int', 'long'].includes(unwrapped.name); }
function unwrapType(type: CType): CType { const seen = new Set<CType>(); let current = type; while (current.kind === 'typedef' && current.target && !seen.has(current)) { seen.add(current); current = current.target; } return current; }
function decay(type: CType): CType { const unwrapped = unwrapType(type); return unwrapped.kind === 'array' ? pointerType(unwrapped.element) : unwrapped.kind === 'function' ? pointerType(unwrapped) : unwrapped; }

export function lowerAggregateArgument(type: CType, source: string, destination: string) {
    return { op: 'copy', args: [source, destination, type.kind] as const };
}

const FLOAT_SUFFIX: Record<'float' | 'double', string> = { float: 'sf3', double: 'df3' };
const FLOAT_OPS: Record<string, string> = { add: 'add', sub: 'sub', mul: 'mul', div: 'div', compare: 'cmp' };

export function lowerFloatOperation(operation: keyof typeof FLOAT_OPS, precision: 'float' | 'double' = 'float') {
    const op = FLOAT_OPS[operation];
    if (!op) throw new Error(`unsupported floating operation '${String(operation)}'`);
    return { op: 'runtime-call', args: [`__${op}${FLOAT_SUFFIX[precision]}`] as const };
}

export function lowerAggregateReturn(type: CType) {
    return { op: 'sret-return', type, hiddenParameter: 'sret' as const };
}
