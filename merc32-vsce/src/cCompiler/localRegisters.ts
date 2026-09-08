import { IRFunction } from './ir';
import { instructionEffects, instructionUses } from './irEffects';
import { flattenFunction } from './optimize';

interface Interval {
    value: number;
    start: number;
    end: number;
    region: number;
    definitions: number;
    valid: boolean;
}

// r7/r8 remain instruction scratch, r4 handles spills and calls, r6 handles fills.
const registers = ['r9', 'r10', 'r11'];

export function allocateLocalRegisters(func: IRFunction): ReadonlyMap<number, string> {
    const intervals = new Map<number, Interval>();
    let region = 0;
    const touch = (value: number, at: number, definition: boolean): void => {
        let interval = intervals.get(value);
        if (!interval) {
            interval = { value, start: at, end: at, region, definitions: 0, valid: definition };
            intervals.set(value, interval);
        }
        interval.end = at;
        interval.valid &&= interval.region === region;
        if (definition) interval.definitions++;
    };
    flattenFunction(func).forEach((instruction, at) => {
        const barrier = instructionEffects(instruction).barrier || instruction.op === 'fill-memory';
        if (instruction.op === 'label' || barrier) region++;
        instructionUses(instruction).forEach(value => touch(value, at, false));
        if (instruction.dest !== undefined) touch(instruction.dest, at, true);
        if (barrier || ['jump', 'branch-zero', 'branch-nonzero', 'ret'].includes(instruction.op)) region++;
    });
    const assigned = new Map<number, string>();
    const active: { end: number; register: string }[] = [];
    const free = [...registers];
    for (const interval of [...intervals.values()].filter(i => i.valid && i.definitions === 1)
        .sort((a, b) => a.start - b.start || a.value - b.value)) {
        for (let index = active.length - 1; index >= 0; index--) {
            if (active[index].end < interval.start) free.push(active.splice(index, 1)[0].register);
        }
        const register = free.pop();
        if (!register) continue;
        assigned.set(interval.value, register);
        active.push({ end: interval.end, register });
    }
    return assigned;
}
