import { IRInstruction } from './ir';

export interface IREffects {
    readonly readsMemory: boolean;
    readonly writesMemory: boolean;
    readonly barrier: boolean;
}

export function instructionEffects(instruction: IRInstruction): IREffects {
    switch (instruction.op) {
        case 'load': case 'load-memory':
            return { readsMemory: true, writesMemory: false, barrier: instruction.volatile === true };
        case 'store': case 'store-memory': case 'fill-memory':
            return { readsMemory: false, writesMemory: true, barrier: instruction.volatile === true };
        case 'constant': case 'convert-integer': case 'move-value': case 'binary': case 'binary-immediate':
        case 'address-local': case 'address-symbol': case 'label': case 'jump':
        case 'branch-zero': case 'branch-nonzero': case 'ret':
            return { readsMemory: false, writesMemory: false, barrier: false };
        default:
            // Calls (including IRQ intrinsics) and future unknown operations are conservative barriers.
            return { readsMemory: true, writesMemory: true, barrier: true };
    }
}

export function instructionUses(instruction: IRInstruction): readonly number[] {
    const a = instruction.args;
    switch (instruction.op) {
        case 'constant': case 'address-local': case 'address-symbol': case 'load': case 'label': case 'jump': return [];
        case 'store': return [Number(a[1])];
        case 'load-memory': case 'convert-integer': case 'move-value':
        case 'branch-zero': case 'branch-nonzero': return [Number(a[0])];
        case 'store-memory': case 'fill-memory': return [Number(a[0]), Number(a[1])];
        case 'binary': return [Number(a[1]), Number(a[2])];
        case 'binary-immediate': return [Number(a[1])];
        case 'call': case 'runtime-call': return a.slice(1).map(Number);
        case 'call-indirect': case 'ret': return a.map(Number);
        default: throw new Error(`unknown IR operation '${instruction.op}' in value analysis`);
    }
}
