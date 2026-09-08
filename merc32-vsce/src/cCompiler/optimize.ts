import { IRFunction, IRInstruction, Merc32Module } from './ir';
import { instructionEffects, instructionUses } from './irEffects';
import { typeSize } from './types';
import { inlineSmallFunctions } from './inline';
import { simplifyControlFlow } from './controlFlow';

const terminators = new Set(['jump', 'branch-zero', 'branch-nonzero', 'ret']);
const pure = new Set(['constant', 'convert-integer', 'move-value', 'binary', 'binary-immediate', 'address-local', 'address-symbol']);

export function flattenFunction(func: IRFunction): IRInstruction[] {
    return func.blocks.flatMap(block => [
        ...(block.label === `${func.name}.entry` ? [] : [{ op: 'label', args: [block.label] }]),
        ...block.instructions,
    ]);
}

export function optimizeModule(module: Merc32Module): Merc32Module {
    const prepared = { ...module, functions: module.functions.map(optimizeFunction) };
    const inlined = inlineSmallFunctions(prepared);
    return { ...inlined, functions: inlined.functions.map(optimizeFunction) };
}

function optimizeFunction(func: IRFunction): IRFunction {
    let result = func;
    let previousLength: number;
    do {
        previousLength = flattenFunction(result).length;
        result = optimizePass(result);
    } while (flattenFunction(result).length < previousLength);
    return result;
}

function optimizePass(func: IRFunction): IRFunction {
    const constants = new Map<number, number>();
    const locals = new Map<number, string>();
    const localTypes = new Map([
        ...(func.parameterNames ?? []).map((name, index) => [name, func.parameters[index]] as const),
        ...(func.localNames ?? []).map((name, index) => [name, func.localTypes?.[index]] as const),
    ]);
    let instructions = flattenFunction(func).flatMap((original): IRInstruction[] => {
        if (original.op === 'label') { constants.clear(); locals.clear(); }
        let instruction = original;
        const a = original.args;
        if (original.op === 'branch-zero' || original.op === 'branch-nonzero') {
            const condition = constants.get(Number(a[0]));
            if (condition !== undefined) {
                const taken = original.op === 'branch-zero' ? (condition | 0) === 0 : (condition | 0) !== 0;
                if (!taken) return [];
                instruction = { ...original, op: 'jump', args: [a[1]] };
            }
        } else if (original.op === 'binary-immediate') {
            const left = constants.get(Number(a[1]));
            const value = left === undefined ? undefined : evaluate(String(a[0]), left, Number(a[2]), !!a[3]);
            if (value !== undefined) instruction = { ...original, op: 'constant', args: [value] };
        } else if (original.op === 'binary') {
            const left = constants.get(Number(a[1]));
            const right = constants.get(Number(a[2]));
            const value = left !== undefined && right !== undefined ? evaluate(String(a[0]), left, right, !!a[3]) : undefined;
            if (value !== undefined) instruction = { ...original, op: 'constant', args: [value] };
            else if (right !== undefined) {
                // ADD/SUB immediates zero-extend on MERC32; encode negative constants with the opposite operation.
                const reverse = (a[0] === '+' || a[0] === '-') && right < 0;
                const operator = reverse ? a[0] === '+' ? '-' : '+' : String(a[0]);
                const immediate = reverse ? -right : right;
                if (immediateFits(operator, immediate)) {
                    instruction = { ...original, op: 'binary-immediate', args: [operator, a[1], immediate, a[3] ?? 0] };
                }
            }
        } else if (original.op === 'convert-integer' || original.op === 'move-value') {
            const input = constants.get(Number(a[0]));
            if (input !== undefined) {
                const shift = 32 - Number(a[1]);
                const value = original.op === 'move-value' ? input : a[2] ? (input << shift) >> shift : (input << shift) >>> shift;
                instruction = { ...original, op: 'constant', args: [value] };
            }
        } else if (original.op === 'load-memory' || original.op === 'store-memory') {
            const local = locals.get(Number(a[0]));
            const type = local === undefined ? undefined : localTypes.get(local);
            const size = Number(a[original.op === 'load-memory' ? 1 : 2]);
            if (local !== undefined && type && typeSize(type) === size) {
                instruction = original.op === 'load-memory'
                    ? { ...original, op: 'load', args: [local, size, a[2]] }
                    : { ...original, op: 'store', args: [local, a[1]] };
            }
        }
        if (instruction.dest !== undefined) {
            constants.delete(instruction.dest); locals.delete(instruction.dest);
            if (instruction.op === 'constant') constants.set(instruction.dest, Number(instruction.args[0]));
            if (instruction.op === 'address-local') locals.set(instruction.dest, String(instruction.args[0]));
        }
        if (terminators.has(instruction.op) || instructionEffects(instruction).barrier) {
            constants.clear(); locals.clear();
        }
        return [instruction];
    });

    instructions = simplifyControlFlow(instructions);

    // Remove only unused pure value computations. Reads, stores and calls remain in order.
    let changed: boolean;
    do {
        const used = new Set(instructions.flatMap(instructionUses));
        const remaining = instructions.filter(i => i.dest === undefined || used.has(i.dest) || !pure.has(i.op));
        changed = remaining.length !== instructions.length;
        instructions = remaining;
    } while (changed);
    return { ...func, blocks: [{ label: `${func.name}.entry`, instructions }] };
}

function immediateFits(operator: string, value: number): boolean {
    if (operator === '+' || operator === '-') return value >= 0 && value <= 65535;
    if (operator === '&' || operator === '|' || operator === '^') return value >= 0 && value <= 65535;
    if (operator === '<<' || operator === '>>') return value >= 0 && value <= 31;
    return false;
}

function evaluate(operator: string, left: number, right: number, unsigned: boolean): number | undefined {
    const a = unsigned ? left >>> 0 : left | 0;
    const b = unsigned ? right >>> 0 : right | 0;
    switch (operator) {
        case '+': return (a + b) | 0;
        case '-': return (a - b) | 0;
        case '*': return Math.imul(a, b);
        case '/': case '%':
            if (b === 0 || !unsigned && a === -2147483648 && b === -1) return undefined;
            return (operator === '/' ? Math.trunc(a / b) : a % b) | 0;
        case '&': return a & b;
        case '|': return a | b;
        case '^': return a ^ b;
        case '<<': case '>>':
            if ((right >>> 0) >= 32) return undefined;
            return operator === '<<' ? a << b : unsigned ? a >>> b : a >> b;
        case '==': return Number(a === b);
        case '!=': return Number(a !== b);
        case '<': return Number(a < b);
        case '<=': return Number(a <= b);
        case '>': return Number(a > b);
        case '>=': return Number(a >= b);
        default: return undefined;
    }
}

interface Block {
    start: number;
    end: number;
    successors: number[];
    use: Set<number>;
    def: Set<number>;
    liveIn: Set<number>;
    liveOut: Set<number>;
}

export function allocateTemporarySlots(func: IRFunction): ReadonlyMap<number, number> {
    const instructions = flattenFunction(func);
    const labels = new Map<string, number>();
    const starts = new Set([0]);
    instructions.forEach((instruction, index) => {
        if (instruction.op === 'label') { labels.set(String(instruction.args[0]), index); starts.add(index); }
        if (terminators.has(instruction.op) && index + 1 < instructions.length) starts.add(index + 1);
    });
    const boundaries = [...starts].sort((a, b) => a - b);
    const blocks: Block[] = boundaries.map((start, index) => ({ start, end: (boundaries[index + 1] ?? instructions.length) - 1,
        successors: [], use: new Set(), def: new Set(), liveIn: new Set(), liveOut: new Set() }));
    const owners = new Map(boundaries.map((start, index) => [start, index]));
    blocks.forEach((block, index) => {
        for (let at = block.start; at <= block.end; at++) {
            const instruction = instructions[at];
            instructionUses(instruction).forEach(value => { if (!block.def.has(value)) block.use.add(value); });
            if (instruction.dest !== undefined) block.def.add(instruction.dest);
        }
        const last = instructions[block.end];
        if (!last) return;
        if (last.op !== 'jump' && last.op !== 'ret' && index + 1 < blocks.length) block.successors.push(index + 1);
        if (last.op === 'jump' || last.op === 'branch-zero' || last.op === 'branch-nonzero') {
            const target = String(last.args[last.op === 'jump' ? 0 : 1]);
            const owner = owners.get(labels.get(target) ?? -1);
            if (owner === undefined) throw new Error(`unknown IR branch label '${target}'`);
            block.successors.push(owner);
        }
    });
    let changed: boolean;
    do {
        changed = false;
        for (let index = blocks.length - 1; index >= 0; index--) {
            const block = blocks[index];
            const out = new Set(block.successors.flatMap(next => [...blocks[next].liveIn]));
            const input = new Set([...block.use, ...[...out].filter(value => !block.def.has(value))]);
            if (!equalSets(block.liveIn, input) || !equalSets(block.liveOut, out)) changed = true;
            block.liveIn = input; block.liveOut = out;
        }
    } while (changed);

    // Conservative whole-function intervals also cover loop backedges and multiple definitions.
    const intervals = new Map<number, { value: number; start: number; end: number }>();
    const touch = (value: number, at: number): void => {
        const interval = intervals.get(value);
        if (interval) { interval.start = Math.min(interval.start, at); interval.end = Math.max(interval.end, at); }
        else intervals.set(value, { value, start: at, end: at });
    };
    instructions.forEach((instruction, at) => {
        instructionUses(instruction).forEach(value => touch(value, at));
        if (instruction.dest !== undefined) touch(instruction.dest, at);
    });
    for (const block of blocks) {
        block.liveIn.forEach(value => touch(value, block.start));
        block.liveOut.forEach(value => touch(value, block.end));
    }
    const assigned = new Map<number, number>();
    const active: { end: number; slot: number }[] = [];
    const free: number[] = [];
    let count = 0;
    for (const interval of [...intervals.values()].sort((a, b) => a.start - b.start || a.value - b.value)) {
        for (let index = active.length - 1; index >= 0; index--) {
            if (active[index].end < interval.start) free.push(active.splice(index, 1)[0].slot);
        }
        const slot = free.pop() ?? count++;
        assigned.set(interval.value, slot); active.push({ end: interval.end, slot });
    }
    return assigned;
}

function equalSets(left: Set<number>, right: Set<number>): boolean {
    return left.size === right.size && [...left].every(value => right.has(value));
}
