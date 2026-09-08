import { Relocation } from '../linker/objectFormat';
import { IRBlock, IRFunction, IRGlobal, IRInstruction, Merc32Module } from './ir';
import { BackendCompileOptions, CType, pointerType, typeAlignment, typeSize } from './types';
import { emitByteInitialization } from './initialization';
import { LoweringExpression, LoweringFunction, LoweringGlobal, LoweringProgram, LoweringStatement } from './loweringModel';

export function lowerProgram(program: LoweringProgram, options: BackendCompileOptions = {}): Merc32Module {
    const globals = program.globals.map(lowerGlobal);
    const occupiedNames = new Set([...globals.map((global) => global.name), ...program.functions.map((func) => func.name)]);
    const functions = program.functions.map((func) => lowerFunction(func, occupiedNames, options));
    if ([...globals, ...functions].some((item) => item.name === '__merc32_init_globals')) {
        throw new Error("reserved compiler symbol '__merc32_init_globals' is already defined");
    }
    functions.push(createGlobalInitializer('__merc32_init_globals', globals, options));
    return { abi: program.abi, functions, globals };
}

function lowerGlobal(global: LoweringGlobal): IRGlobal {
    if (!global.initializer) return { name: global.name, binding: global.binding, type: global.type };
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
    return { name: global.name, binding: global.binding, type: global.type, initializerBytes: [...bytes], initializerRelocations: relocations };
}

function createGlobalInitializer(name: string, globals: readonly IRGlobal[], options: BackendCompileOptions): IRFunction {
    const instructions: IRInstruction[] = []; let nextValue = 0;
    for (const global of globals) {
        const base = nextValue++; instructions.push({ op: 'address-symbol', args: [global.name], dest: base });
        const bytes = global.initializerBytes ?? global.initializer;
        if (options.optimization === 'basic') {
            emitByteInitialization(instructions, () => nextValue++, base, typeSize(global.type), bytes,
                volatileStorage(global.type), undefined, (global.initializerRelocations ?? []).map(r => ({ offset: r.offset, size: 4 })));
        } else (bytes ?? Array.from({ length: typeSize(global.type) }, () => 0)).forEach((byte, offset) => {
            if ((global.initializerRelocations ?? []).some((relocation) => offset >= relocation.offset && offset < relocation.offset + 4)) return;
            let address = base;
            if (offset !== 0) { const off = nextValue++; instructions.push({ op: 'constant', args: [offset], dest: off }); address = nextValue++; instructions.push({ op: 'binary', args: ['+', base, off], dest: address }); }
            const value = nextValue++; instructions.push({ op: 'constant', args: [byte], dest: value }, { op: 'store-memory', args: [address, value, 1], volatile: volatileStorage(global.type) });
        });
        for (const relocation of global.initializerRelocations ?? []) {
            const offset = nextValue++;
            const address = nextValue++;
            const target = nextValue++;
            instructions.push({ op: 'constant', args: [relocation.offset], dest: offset },
                { op: 'binary', args: ['+', base, offset], dest: address },
                { op: 'address-symbol', args: [relocation.symbol], dest: target, location: relocation.debug });
            let value = target;
            if (relocation.addend !== 0) {
                const addend = nextValue++;
                value = nextValue++;
                instructions.push({ op: 'constant', args: [relocation.addend], dest: addend },
                    { op: 'binary', args: ['+', target, addend], dest: value });
            }
            instructions.push({ op: 'store-memory', args: [address, value, 4], volatile: volatileStorage(global.type) });
        }
    }
    const zero = nextValue++; instructions.push({ op: 'constant', args: [0], dest: zero }, { op: 'ret', args: [zero] });
    return { name, binding: 'local', parameters: [], parameterNames: [], localNames: [], localTypes: [], blocks: [{ label: `${name}.entry`, instructions }] };
}

function lowerFunction(func: LoweringFunction, occupiedNames: Set<string>, options: BackendCompileOptions): IRFunction {
    const lowerer = new FunctionLowerer(func, occupiedNames, options);
    lowerer.lowerStatement(func.body);
    if (lowerer.instructions.length === 0 || lowerer.instructions[lowerer.instructions.length - 1].op !== 'ret') lowerer.instructions.push({ op: 'ret', args: [lowerer.constant(0)] });
    return { name: func.name, binding: func.binding, returnType: isAggregate(func.returnType) ? pointerType(func.returnType) : func.returnType, parameters: lowerer.parameters, parameterNames: lowerer.parameterNames, localNames: lowerer.localNames, localTypes: lowerer.localTypes, returnLabel: lowerer.returnLabel(), blocks: [{ label: `${func.name}.entry`, instructions: lowerer.instructions }] };
}

class FunctionLowerer {
    readonly instructions: IRInstruction[] = [];
    readonly localNames: string[] = [];
    readonly localTypes: CType[] = [];
    readonly parameters: CType[];
    readonly parameterNames: string[];
    private readonly aggregateParameters = new Set<string>();
    private readonly resultParameter?: string;
    private nextValue = 0;
    private nextLabel = 0;
    private readonly breakLabels: string[] = [];
    private readonly continueLabels: string[] = [];
    private readonly switchCases: Array<Map<LoweringStatement, string>> = [];
    private readonly userLabels = new Map<string, string>();
    private readonly labels = new Set<string>();
    private readonly variables = new Map<string, CType>();
    private readonly temporaryObjects = new Map<LoweringExpression, string>();
    public constructor(private readonly func: LoweringFunction, private readonly occupiedNames: Set<string>, private readonly options: BackendCompileOptions) {
        this.parameters = func.parameters.map(type => isAggregate(type) ? pointerType(type) : type);
        this.parameterNames = [...func.parameterNames];
        func.parameterNames.forEach((name, index) => { if (name) this.variables.set(name, func.parameters[index]); });
        func.parameterNames.forEach((name, index) => {
            if (isAggregate(func.parameters[index])) this.aggregateParameters.add(name);
        });
        if (isAggregate(func.returnType)) {
            this.resultParameter = this.label('sret');
            this.parameters.unshift(pointerType(func.returnType));
            this.parameterNames.unshift(this.resultParameter);
        }
    }
    public lowerStatement(statement: LoweringStatement): void {
        switch (statement.kind) {
            case 'compound': statement.statements.forEach((child) => this.lowerStatement(child)); return;
            case 'declaration': {
                const binding = statement.binding ?? statement.name;
                this.localNames.push(binding); this.localTypes.push(statement.type); this.variables.set(binding, statement.type);
                if (statement.initializer && !('size' in statement.initializer)) {
                    if (!isAggregate(statement.type)) {
                        this.instructions.push({ op: 'store', args: [binding, this.lowerExpression(statement.initializer)], volatile: volatileStorage(statement.type), location: statement.location });
                    } else this.initializeObject(this.addressLocal(binding), statement.type, statement.initializer);
                }
                return;
            }
            case 'expression': this.lowerExpression(statement.expression); return;
            case 'return': {
                let value = statement.expression ? this.lowerExpression(statement.expression) : this.constant(0);
                if (this.resultParameter && statement.expression) {
                    const destination = this.loadAddress(this.addressLocal(this.resultParameter), pointerType(this.func.returnType), statement.location);
                    this.copyObject(destination, value, typeSize(this.func.returnType), statement.location, volatileExpression(statement.expression));
                    value = destination;
                }
                this.instructions.push({ op: 'ret', args: [value], location: statement.location });
                return;
            }
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
        if (expression.kind === 'compound-literal') return this.materializeLiteral(expression);
        if (expression.kind === 'binary' && expression.operator === ',') {
            this.lowerExpression(expression.operands[0]);
            return this.lowerExpression(expression.operands[1]);
        }
        if (expression.constant !== undefined) { if (typeof expression.constant === 'bigint') return this.constant(Number(expression.constant), expression.location); if ('symbol' in expression.constant) { const address = this.addressSymbol(expression.constant.symbol, expression.location); if (expression.constant.addend !== 0n) return this.addAddressOffset(address, this.constant(Number(expression.constant.addend), expression.location), expression.location); return address; } throw new Error('string expression constants are not scalar values'); }
        switch (expression.kind) {
            case 'declaration-reference': case 'identifier': { const baseType = unwrapType(expression.type); if (expression.valueCategory === 'function' || baseType.kind === 'function' || baseType.kind === 'array') return this.lowerLValueAddress(expression); if (expression.constant !== undefined) return this.lowerExpression({ ...expression, kind: 'integer-literal' }); return this.loadLValue(expression); }
            case 'conversion': {
                const value = this.lowerExpression(expression.operands[0]);
                if (isAggregate(expression.type) || unwrapType(expression.type).kind === 'function') return value;
                return this.convertInteger(value, expression.targetType ?? expression.type, expression.location);
            }
            case 'unary': return this.lowerUnary(expression);
            case 'binary': if (expression.operator === '&&' || expression.operator === '||') return this.lowerLogical(expression); { let left = this.lowerExpression(expression.operands[0]); let right = this.lowerExpression(expression.operands[1]); const leftType = decay(expression.operands[0].type); const rightType = decay(expression.operands[1].type); if ((expression.operator === '+' || expression.operator === '-') && leftType.kind === 'pointer' && rightType.kind !== 'pointer') right = this.scalePointerOffset(right, typeSize(leftType.pointee), expression.location); else if (expression.operator === '+' && rightType.kind === 'pointer' && leftType.kind !== 'pointer') left = this.scalePointerOffset(left, typeSize(rightType.pointee), expression.location); if (expression.operator === '-' && leftType.kind === 'pointer' && rightType.kind === 'pointer') { const difference = this.allocateValue(); this.instructions.push({ op: 'binary', args: ['-', left, right], dest: difference, location: expression.location }); const size = typeSize(leftType.pointee); if (size !== 1) return this.divideBy(difference, size, expression.location); return difference; } const result = this.allocateValue(); this.instructions.push({ op: 'binary', args: [expression.operator ?? '', left, right, isSigned(leftType) ? 0 : 1], dest: result, location: expression.location }); return result; }
            case 'assignment': return this.lowerAssignment(expression);
            case 'call': {
                const callee = expression.operands[0];
                let directCallee = callee;
                while (directCallee.kind === 'conversion' && directCallee.conversion === 'function-to-pointer'
                    || directCallee.kind === 'unary' && directCallee.operator === 'parentheses') directCallee = directCallee.operands[0];
                // Capture each aggregate value before another argument can call into code that modifies its source.
                const args = expression.operands.slice(1).map(operand => {
                    const value = this.lowerExpression(operand);
                    if (!isAggregate(operand.type)) return value;
                    const copy = this.temporaryObject(operand.type, 'argument');
                    this.copyObject(copy, value, typeSize(operand.type), operand.location, volatileExpression(operand));
                    return copy;
                });
                const result = isAggregate(expression.type) ? this.temporaryObject(expression.type, 'result') : undefined;
                if (result !== undefined) args.unshift(result);
                const dest = this.allocateValue();
                if (directCallee.symbol && unwrapType(directCallee.type).kind === 'function') this.instructions.push({ op: 'call', args: [directCallee.symbol, ...args], dest, location: directCallee.location });
                else this.instructions.push({ op: 'call-indirect', args: [this.lowerExpression(callee), ...args], dest, location: expression.location });
                return result ?? dest;
            }
            case 'conditional': { const result = this.allocateValue(); const alternateLabel = this.label('conditional_alternate'); const endLabel = this.label('conditional_end'); const condition = this.lowerExpression(expression.operands[0]); this.instructions.push({ op: 'branch-zero', args: [condition, alternateLabel], location: expression.location }); const consequent = this.lowerExpression(expression.operands[1]); this.instructions.push({ op: 'move-value', args: [consequent], dest: result, location: expression.operands[1].location }, { op: 'jump', args: [endLabel] }, { op: 'label', args: [alternateLabel] }); const alternate = this.lowerExpression(expression.operands[2]); this.instructions.push({ op: 'move-value', args: [alternate], dest: result, location: expression.operands[2].location }, { op: 'label', args: [endLabel] }); return result; }
            case 'subscript': case 'member': return this.loadLValue(expression);
            case 'sizeof': case 'alignof': return this.constant(Number(expression.constant ?? 0n), expression.location);
            default: throw new Error(`typed lowering does not support '${expression.kind}'`);
        }
    }
    private convertInteger(value: number, type: CType, location: IRInstruction['location']): number {
        const target = unwrapType(type);
        if (target.kind === 'builtin' && target.name === '_Bool') {
            return this.binary('!=', value, this.constant(0, location), false, location);
        }
        if (typeSize(target) > 0 && typeSize(target) < 4) {
            const result = this.allocateValue();
            this.instructions.push({ op: 'convert-integer', args: [value, typeSize(target) * 8, isSigned(target) ? 1 : 0], dest: result, location });
            return result;
        }
        return value;
    }
    private binary(operator: string, left: number, right: number, unsigned: boolean, location: IRInstruction['location']): number {
        const result = this.allocateValue();
        this.instructions.push({ op: 'binary', args: [operator, left, right, unsigned ? 1 : 0], dest: result, location });
        return result;
    }
    private loadAddress(address: number, type: CType, location: IRInstruction['location'], volatile = volatileStorage(type)): number {
        const result = this.allocateValue();
        this.instructions.push({ op: 'load-memory', args: [address, typeSize(type), isSigned(type) ? 1 : 0], dest: result, volatile, location });
        return result;
    }
    private lowerUnary(expression: LoweringExpression): number {
        const operand = expression.operands[0];
        const operator = expression.operator!;
        const location = expression.location;
        if (operator === '&') return this.lowerLValueAddress(operand);
        if (operator === '*') return unwrapType(expression.type).kind === 'function'
            ? this.lowerExpression(operand) : this.loadLValue(expression);
        if (['pre++', 'post++', 'pre--', 'post--'].includes(operator)) {
            const address = this.lowerLValueAddress(operand);
            const old = this.loadAddress(address, operand.type, location, volatileExpression(operand));
            const type = unwrapType(operand.type);
            const step = type.kind === 'pointer' ? typeSize(type.pointee) : 1;
            const updated = this.binary(operator.endsWith('++') ? '+' : '-', old, this.constant(step, location), false, location);
            const value = this.convertInteger(updated, operand.type, location);
            this.instructions.push({ op: 'store-memory', args: [address, value, typeSize(operand.type)], volatile: volatileExpression(operand), location });
            return operator.startsWith('post') ? old : value;
        }
        const value = this.lowerExpression(operand);
        if (operator === 'cast') return this.convertInteger(value, expression.type, location);
        if (operator === '+' || operator === 'parentheses') return value;
        if (operator === '-') return this.binary('-', this.constant(0, location), value, false, location);
        if (operator === '!') return this.binary('==', value, this.constant(0, location), false, location);
        if (operator === '~') return this.binary('^', value, this.constant(-1, location), false, location);
        throw new Error(`typed lowering does not support unary operator '${operator}'`);
    }
    private lowerAssignment(expression: LoweringExpression): number {
        const [target, rhs] = expression.operands;
        const location = expression.location;
        const binding = target.binding ?? target.symbol;
        if (expression.operator === '=' && binding && this.variables.has(binding) && !isAggregate(target.type)) {
            const value = this.lowerExpression(rhs);
            this.instructions.push({ op: 'store', args: [binding, value], volatile: volatileExpression(target), location });
            return value;
        }
        const address = this.lowerLValueAddress(target);
        if (isAggregate(target.type)) {
            this.copyObject(address, this.lowerExpression(rhs), typeSize(target.type), location, volatileExpression(target) || volatileExpression(rhs));
            return address;
        }
        let value: number;
        if (expression.operator === '=') value = this.lowerExpression(rhs);
        else {
            const left = this.loadAddress(address, target.type, location, volatileExpression(target));
            let right = this.lowerExpression(rhs);
            const type = unwrapType(expression.computationType ?? target.type);
            const operator = expression.operator!.slice(0, -1);
            if (type.kind === 'pointer') right = this.scalePointerOffset(right, typeSize(type.pointee), location);
            value = this.binary(operator, left, right, !isSigned(type), location);
        }
        value = this.convertInteger(value, target.type, location);
        this.instructions.push({ op: 'store-memory', args: [address, value, typeSize(target.type)], volatile: volatileExpression(target), location });
        return value;
    }
    private loadLValue(expression: LoweringExpression): number {
        const address = this.lowerLValueAddress(expression);
        if (isAggregate(expression.type) || unwrapType(expression.type).kind === 'function') return address;
        return this.loadAddress(address, expression.type, expression.location, volatileExpression(expression));
    }
    private copyObject(destination: number, source: number, size: number, location: IRInstruction['location'], volatile = false): void {
        if (size > 16) {
            // C object copies have disjoint or identical storage. Keep large copies bounded in code and spill slots.
            const offset = this.constant(0, location);
            const limit = this.constant(size, location);
            const one = this.constant(1, location);
            const loop = this.label('copy');
            this.instructions.push({ op: 'label', args: [loop] });
            const from = this.addAddressOffset(source, offset, location);
            const to = this.addAddressOffset(destination, offset, location);
            const value = this.allocateValue();
            this.instructions.push({ op: 'load-memory', args: [from, 1, 0], dest: value, volatile, location },
                { op: 'store-memory', args: [to, value, 1], volatile, location });
            const next = this.binary('+', offset, one, false, location);
            this.instructions.push({ op: 'move-value', args: [next], dest: offset, location });
            const more = this.binary('<', offset, limit, true, location);
            this.instructions.push({ op: 'branch-nonzero', args: [more, loop], location });
            return;
        }
        const values: number[] = [];
        for (let offset = 0; offset < size; offset++) {
            const address = this.addAddressOffset(source, this.constant(offset), location);
            const value = this.allocateValue();
            this.instructions.push({ op: 'load-memory', args: [address, 1, 0], dest: value, volatile, location });
            values.push(value);
        }
        values.forEach((value, offset) => {
            const address = this.addAddressOffset(destination, this.constant(offset), location);
            this.instructions.push({ op: 'store-memory', args: [address, value, 1], volatile, location });
        });
    }
    private temporaryObject(type: CType, prefix: string): number {
        const name = this.label(prefix);
        this.localNames.push(name); this.localTypes.push(type);
        return this.addressLocal(name);
    }
    private materializeLiteral(expression: LoweringExpression, addressOnly = false): number {
        let name = this.temporaryObjects.get(expression);
        if (!name) {
            name = this.label('literal');
            this.temporaryObjects.set(expression, name);
            this.localNames.push(name); this.localTypes.push(expression.type); this.variables.set(name, expression.type);
        }
        const address = this.addressLocal(name);
        this.initializeObject(address, expression.type, expression);
        return addressOnly || isAggregate(expression.type) ? address : this.loadAddress(address, expression.type, expression.location);
    }
    private initializeObject(address: number, type: CType, expression: LoweringExpression, inheritedVolatile = false): void {
        const volatile = inheritedVolatile || volatileStorage(type);
        if (expression.kind === 'conversion' && isAggregate(type)) {
            return this.initializeObject(address, type, expression.operands[0], volatile);
        }
        const location = expression.location;
        if (expression.stringBytes && unwrapType(type).kind === 'array') {
            if (this.options.optimization === 'basic') {
                emitByteInitialization(this.instructions, () => this.allocateValue(), address, typeSize(type), expression.stringBytes, volatile, location);
                return;
            }
            for (let offset = 0; offset < typeSize(type); offset++) {
                const value = this.constant(expression.stringBytes[offset] ?? 0, location);
                this.instructions.push({ op: 'store-memory', args: [this.addAddressOffset(address, this.constant(offset), location), value, 1], volatile, location });
            }
        } else if (expression.kind === 'compound-literal') {
            const base = unwrapType(type);
            if (this.options.optimization === 'basic') {
                emitByteInitialization(this.instructions, () => this.allocateValue(), address, typeSize(type), undefined, volatile, location);
            } else {
                const zero = this.constant(0);
                for (let offset = 0; offset < typeSize(type); offset++) {
                    this.instructions.push({ op: 'store-memory', args: [this.addAddressOffset(address, this.constant(offset), location), zero, 1], volatile, location });
                }
            }
            expression.operands.forEach((child, position) => {
                const index = expression.initializerIndices?.[position] ?? position;
                const member = base.kind === 'struct' || base.kind === 'union' ? base.fields[index] : undefined;
                const childType = base.kind === 'array' ? base.element : member?.type ?? type;
                const offset = base.kind === 'array' ? index * typeSize(childType) : member?.offset ?? 0;
                this.initializeObject(this.addAddressOffset(address, this.constant(offset), location), childType, child, volatile);
            });
        } else if (isAggregate(type)) {
            this.copyObject(address, this.lowerExpression(expression), typeSize(type), location, volatile || volatileExpression(expression));
        } else {
            const value = this.convertInteger(this.lowerExpression(expression), type, location);
            this.instructions.push({ op: 'store-memory', args: [address, value, typeSize(type)], volatile, location });
        }
    }
    private lowerLValueAddress(expression: LoweringExpression): number {
        if (expression.kind === 'compound-literal') return this.materializeLiteral(expression, true);
        if (expression.kind === 'declaration-reference' || expression.kind === 'identifier') {
            const binding = expression.binding ?? expression.symbol;
            if (binding && this.aggregateParameters.has(binding)) {
                return this.loadAddress(this.addressLocal(binding), pointerType(expression.type), expression.location);
            }
            return binding && this.variables.has(binding) ? this.addressLocal(binding) : this.addressSymbol(expression.symbol ?? '', expression.location);
        }
        if (expression.kind === 'unary' && expression.operator === 'parentheses') return this.lowerLValueAddress(expression.operands[0]);
        if (expression.kind === 'unary' && expression.operator === '*') return this.lowerExpression(expression.operands[0]);
        if (expression.kind === 'subscript') {
            return this.addAddressOffset(this.lowerExpression(expression.operands[0]),
                this.scalePointerOffset(this.lowerExpression(expression.operands[1]), typeSize(expression.type), expression.location), expression.location);
        }
        if (expression.kind === 'member') {
            const baseExpression = expression.operands[0];
            const baseType = unwrapType(baseExpression.type);
            const base = baseType.kind === 'pointer' || baseExpression.valueCategory === 'rvalue'
                ? this.lowerExpression(baseExpression) : this.lowerLValueAddress(baseExpression);
            return expression.memberOffset ? this.addAddressOffset(base, this.constant(expression.memberOffset), expression.location) : base;
        }
        if (isAggregate(expression.type)) return this.lowerExpression(expression);
        throw new Error(`typed lowering cannot take the address of '${expression.kind}'`);
    }
    private addressLocal(name: string): number { const result = this.allocateValue(); this.instructions.push({ op: 'address-local', args: [name], dest: result }); return result; }
    private addressSymbol(name: string, location?: IRInstruction['location']): number { const result = this.allocateValue(); this.instructions.push({ op: 'address-symbol', args: [name], dest: result, location }); return result; }
    private addAddressOffset(base: number, offset: number, location: IRInstruction['location']): number { const result = this.allocateValue(); this.instructions.push({ op: 'binary', args: ['+', base, offset], dest: result, location }); return result; }
    private scalePointerOffset(value: number, size: number, location: IRInstruction['location']): number { if (size === 1) return value; const scale = this.constant(size, location); const result = this.allocateValue(); this.instructions.push({ op: 'binary', args: ['*', value, scale], dest: result, location }); return result; }
    private divideBy(value: number, size: number, location: IRInstruction['location']): number { if (size === 1) return value; const scale = this.constant(size, location); const result = this.allocateValue(); this.instructions.push({ op: 'binary', args: ['/', value, scale], dest: result, location }); return result; }
    private lowerLogical(expression: LoweringExpression): number { const result = this.allocateValue(); const yes = this.label('logic_true'); const no = this.label('logic_false'); const end = this.label('logic_end'); const left = this.lowerExpression(expression.operands[0]); if (expression.operator === '&&') { this.instructions.push({ op: 'branch-zero', args: [left, no] }); const right = this.lowerExpression(expression.operands[1]); this.instructions.push({ op: 'branch-zero', args: [right, no] }, { op: 'jump', args: [yes] }); } else { this.instructions.push({ op: 'branch-nonzero', args: [left, yes] }); const right = this.lowerExpression(expression.operands[1]); this.instructions.push({ op: 'branch-nonzero', args: [right, yes] }, { op: 'jump', args: [no] }); } this.instructions.push({ op: 'label', args: [yes] }, { op: 'constant', args: [1], dest: result }, { op: 'jump', args: [end] }, { op: 'label', args: [no] }, { op: 'constant', args: [0], dest: result }, { op: 'label', args: [end] }); return result; }
    public returnLabel(): string { return this.label('return'); }
    private label(prefix: string): string { let candidate = `__${this.func.name}_${prefix}_${this.nextLabel++}`; while (this.labels.has(candidate) || this.occupiedNames.has(candidate)) candidate = `__${this.func.name}_${prefix}_${this.nextLabel++}`; this.labels.add(candidate); this.occupiedNames.add(candidate); return candidate; }
    private allocateValue(): number { return this.nextValue++; }
    public constant(value: number, location?: IRInstruction['location']): number { const dest = this.allocateValue(); this.instructions.push({ op: 'constant', args: [value], dest, location }); return dest; }
    private userLabel(label: string): string { const existing = this.userLabels.get(label); if (existing) return existing; let generated = `__${this.func.name}_user_${label}`; let serial = 0; while (this.labels.has(generated) || this.occupiedNames.has(generated)) generated = `__${this.func.name}_user_${label}_${serial++}`; this.labels.add(generated); this.occupiedNames.add(generated); this.userLabels.set(label, generated); return generated; }
}

function isStatement(value: LoweringExpression | LoweringStatement): value is LoweringStatement {
    return ['compound', 'declaration', 'expression', 'return', 'if', 'while', 'do-while', 'for', 'switch', 'case', 'default', 'break', 'continue', 'goto', 'label', 'empty'].includes(value.kind);
}
function collectCases(statement: LoweringStatement, makeLabel: (prefix: string) => string): Array<{ statement: LoweringStatement; label: string }> { const entries: Array<{ statement: LoweringStatement; label: string }> = []; const visit = (current: LoweringStatement): void => { if (current.kind === 'compound') current.statements.forEach(visit); else if (current.kind === 'case' || current.kind === 'default') { entries.push({ statement: current, label: makeLabel(current.kind) }); visit(current.statement); } else if (current.kind === 'if') { visit(current.thenBranch); if (current.elseBranch) visit(current.elseBranch); } else if (current.kind === 'label') { if (current.statement) visit(current.statement); } else if (current.kind === 'switch') { return; } else if ('body' in current && current.body) visit(current.body); }; visit(statement); return entries; }
function isSigned(type: CType): boolean { const unwrapped = unwrapType(type); return unwrapped.kind === 'enum' || unwrapped.kind === 'builtin' && ['char', 'signed char', 'short', 'int', 'long'].includes(unwrapped.name); }
function isAggregate(type: CType): boolean { return ['struct', 'union', 'array'].includes(unwrapType(type).kind); }
function volatileStorage(type: CType): boolean {
    if (type.qualifiers.volatile) return true;
    if (type.kind === 'typedef' && type.target) return volatileStorage(type.target);
    if (type.kind === 'array') return volatileStorage(type.element);
    if (type.kind === 'struct' || type.kind === 'union') return type.fields.some(field => volatileStorage(field.type));
    return false;
}
function volatileExpression(expression: LoweringExpression): boolean {
    if (volatileStorage(expression.type)) return true;
    if (expression.kind === 'conversion' || expression.kind === 'unary' && expression.operator === 'parentheses') {
        return volatileExpression(expression.operands[0]);
    }
    if (expression.kind === 'member' || expression.kind === 'subscript'
        || expression.kind === 'unary' && expression.operator === '*') {
        const base = expression.operands[0];
        const type = unwrapType(base.type);
        return type.kind === 'pointer' ? volatilePointee(base) : volatileExpression(base);
    }
    return false;
}
function volatilePointee(expression: LoweringExpression): boolean {
    const type = unwrapType(expression.type);
    if (type.kind === 'pointer' && volatileStorage(type.pointee)) return true;
    if (expression.kind === 'conversion' && expression.conversion === 'array-to-pointer'
        || expression.kind === 'unary' && expression.operator === '&') return volatileExpression(expression.operands[0]);
    if (expression.kind === 'unary' && expression.operator === 'parentheses') return volatilePointee(expression.operands[0]);
    if (expression.kind === 'binary' && (expression.operator === '+' || expression.operator === '-')) {
        return expression.operands.some(operand => unwrapType(operand.type).kind === 'pointer' && volatilePointee(operand));
    }
    return false;
}
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
