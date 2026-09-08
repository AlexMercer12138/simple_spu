import { IRFunction, IRInstruction, Merc32Module } from './ir';
import { instructionUses } from './irEffects';
import { CType, typeSize } from './types';

const maximumBody = 12;
const maximumExpansion = 64;
const operations = new Set(['constant', 'load', 'load-memory', 'store-memory', 'address-symbol',
    'convert-integer', 'move-value', 'binary', 'binary-immediate', 'ret']);

function scalar(type: CType): boolean {
    if (type.kind === 'typedef') return !!type.target && scalar(type.target);
    if (type.kind === 'pointer') {
        let pointee = type.pointee;
        while (pointee.kind === 'typedef' && pointee.target) pointee = pointee.target;
        return pointee.kind !== 'struct' && pointee.kind !== 'union';
    }
    return type.kind === 'builtin' || type.kind === 'enum';
}

function ordinaryParameter(type: CType): boolean {
    if (type.qualifiers.volatile || type.qualifiers.atomic) return false;
    return type.kind === 'typedef' ? !!type.target && ordinaryParameter(type.target) : scalar(type);
}

function candidate(func: IRFunction): boolean {
    if (func.name === 'main' || func.name.startsWith('__') || !func.returnType || !scalar(func.returnType)
        || (func.localNames?.length ?? 0) !== 0 || func.blocks.length !== 1
        || func.parameters.length > 8 || func.parameterNames?.length !== func.parameters.length
        || func.parameters.some(type => !ordinaryParameter(type))) return false;
    const body = func.blocks[0].instructions;
    if (body.length > maximumBody || body[body.length - 1]?.op !== 'ret') return false;
    const parameters = new Map(func.parameterNames.map((name, index) => [name, func.parameters[index]]));
    const defined = new Set<number>();
    return body.every((instruction, index) => {
        if (!operations.has(instruction.op) || instruction.op === 'ret' && index !== body.length - 1
            || instructionUses(instruction).some(value => !defined.has(value))) return false;
        if (instruction.op === 'load') {
            const type = parameters.get(String(instruction.args[0]));
            if (!type || instruction.volatile || instruction.args.length !== 3
                || typeSize(type) !== instruction.args[1]) return false;
        }
        if (instruction.dest !== undefined) {
            if (defined.has(instruction.dest)) return false;
            defined.add(instruction.dest);
        }
        return true;
    });
}

function remap(instruction: IRInstruction, value: (id: number) => number): IRInstruction['args'] {
    const a = instruction.args;
    switch (instruction.op) {
        case 'constant': case 'address-symbol': return a;
        case 'load-memory': case 'convert-integer': case 'move-value': return [value(Number(a[0])), ...a.slice(1)];
        case 'store-memory': return [value(Number(a[0])), value(Number(a[1])), ...a.slice(2)];
        case 'binary': return [a[0], value(Number(a[1])), value(Number(a[2])), ...a.slice(3)];
        case 'binary-immediate': return [a[0], value(Number(a[1])), ...a.slice(2)];
        default: throw new Error(`unsupported inline operation '${instruction.op}'`);
    }
}

/** One bounded pass over the original leaf candidates prevents recursive or cascading expansion. */
export function inlineSmallFunctions(module: Merc32Module): Merc32Module {
    const candidates = new Map(module.functions.filter(candidate).map(func => [func.name, func]));
    return { ...module, functions: module.functions.map(caller => {
        let nextValue = 0;
        for (const block of caller.blocks) for (const instruction of block.instructions) {
            for (const value of instructionUses(instruction)) nextValue = Math.max(nextValue, value + 1);
            if (instruction.dest !== undefined) nextValue = Math.max(nextValue, instruction.dest + 1);
        }
        let remaining = maximumExpansion;
        return { ...caller, blocks: caller.blocks.map(block => ({ ...block,
            instructions: block.instructions.flatMap(call => {
                const callee = call.op === 'call' ? candidates.get(String(call.args[0])) : undefined;
                if (!callee || callee.name === caller.name || call.args.length !== callee.parameters.length + 1) return [call];
                const body = callee.blocks[0].instructions;
                if (body.length > remaining) return [call];
                remaining -= body.length;
                const argumentsByName = new Map(callee.parameterNames!.map((name, index) => [name, Number(call.args[index + 1])]));
                const values = new Map<number, number>();
                const mapped = (id: number) => {
                    const value = values.get(id);
                    if (value === undefined) throw new Error(`undefined inline value '${id}' in '${callee.name}'`);
                    return value;
                };
                const expanded: IRInstruction[] = [];
                for (const instruction of body) {
                    if (instruction.op === 'ret') {
                        if (call.dest !== undefined) expanded.push(instruction.args.length
                            ? { ...call, op: 'move-value', args: [mapped(Number(instruction.args[0]))] }
                            : { ...call, op: 'constant', args: [0] });
                        continue;
                    }
                    if (instruction.op === 'load') {
                        const argument = argumentsByName.get(String(instruction.args[0]))!;
                        // Match the original parameter slot's byte/halfword truncation and extension.
                        if (instruction.args[1] === 4) values.set(instruction.dest!, argument);
                        else {
                            const dest = nextValue++;
                            values.set(instruction.dest!, dest);
                            expanded.push({ ...instruction, op: 'convert-integer',
                                args: [argument, Number(instruction.args[1]) * 8, instruction.args[2]], dest });
                        }
                        continue;
                    }
                    const args = remap(instruction, mapped);
                    const dest = instruction.dest === undefined ? undefined : nextValue++;
                    if (instruction.dest !== undefined) values.set(instruction.dest, dest!);
                    expanded.push({ ...instruction, args, ...(dest === undefined ? {} : { dest }) });
                }
                return expanded;
            }),
        })) };
    }) };
}
