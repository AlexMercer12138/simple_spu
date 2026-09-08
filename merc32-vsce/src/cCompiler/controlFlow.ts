import { IRInstruction } from './ir';

function targetIndex(instruction: IRInstruction): number | undefined {
    return instruction.op === 'jump' ? 0
        : instruction.op === 'branch-zero' || instruction.op === 'branch-nonzero' ? 1 : undefined;
}

/** Thread empty jump blocks, retain entry-reachable instructions, then remove fallthrough jumps. */
export function simplifyControlFlow(input: readonly IRInstruction[]): IRInstruction[] {
    let instructions = [...input];
    let previousLength: number;
    do {
        previousLength = instructions.length;
        const labels = new Map<string, number>();
        instructions.forEach((instruction, index) => {
            if (instruction.op !== 'label') return;
            const label = String(instruction.args[0]);
            if (labels.has(label)) throw new Error(`duplicate IR branch label '${label}'`);
            labels.set(label, index);
        });
        const address = (label: string): number => {
            const index = labels.get(label);
            if (index === undefined) throw new Error(`unknown IR branch label '${label}'`);
            return index;
        };
        const ultimate = (label: string): string => {
            const visited = new Set<string>();
            let current = label;
            while (!visited.has(current)) {
                visited.add(current);
                let at = address(current);
                while (instructions[at]?.op === 'label') at++;
                if (instructions[at]?.op !== 'jump') return current;
                current = String(instructions[at].args[0]);
            }
            // Preserve cycles rather than accidentally turning an infinite loop into fallthrough.
            return label;
        };
        const threaded = instructions.map(instruction => {
            const operand = targetIndex(instruction);
            if (operand === undefined) return instruction;
            const args = [...instruction.args];
            args[operand] = ultimate(String(args[operand]));
            return { ...instruction, args };
        });
        const reachable = new Set<number>();
        const pending = threaded.length ? [0] : [];
        while (pending.length) {
            const at = pending.pop()!;
            if (at >= threaded.length || reachable.has(at)) continue;
            reachable.add(at);
            const instruction = threaded[at];
            const operand = targetIndex(instruction);
            if (operand !== undefined) pending.push(address(String(instruction.args[operand])));
            if (instruction.op !== 'jump' && instruction.op !== 'ret') pending.push(at + 1);
        }
        instructions = threaded.filter((_, index) => reachable.has(index));
        instructions = instructions.filter((instruction, index) => {
            const operand = targetIndex(instruction);
            if (operand === undefined) return true;
            for (let next = index + 1; instructions[next]?.op === 'label'; next++) {
                if (instructions[next].args[0] === instruction.args[operand]) return false;
            }
            return true;
        });
        const referenced = new Set(instructions.flatMap(instruction => {
            const operand = targetIndex(instruction);
            return operand === undefined ? [] : [String(instruction.args[operand])];
        }));
        instructions = instructions.filter(instruction => instruction.op !== 'label' || referenced.has(String(instruction.args[0])));
    } while (instructions.length < previousLength);
    return instructions;
}
