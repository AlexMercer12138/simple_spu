import { assembleToObject } from '../linker/assembleObject';
import { Merc32Object } from '../linker/objectFormat';

export function createCStartupObject(options: Readonly<{
    stackTop: number;
    vectorAddress: number;
    entry: string;
    irqHandler: boolean;
}>): Merc32Object {
    const entry = options.entry;
    const halt = `${entry}_halt`;
    const vector = `${entry}_vector`;
    const context = ['r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12', 'r14'];
    const lines = [
        ...(options.irqHandler ? [`jmp ${vector}`] : []),
        `${entry}:`,
        `mov r13, 0x${(options.stackTop >>> 16).toString(16)}`,
        'mov r13, r13 << 16',
        `mov r13, r13 | 0x${(options.stackTop & 0xffff).toString(16)}`,
        'mov r1, 0',
        'jmp __merc32_init_globals, r14',
        ...(options.irqHandler ? [`mov r2, 0x${options.vectorAddress.toString(16)}`] : []),
        'jmp main, r14',
        `${halt}:`,
        `jmp ${halt}`,
    ];
    if (options.irqHandler) lines.push(
        `${vector}:`,
        `mov r13, r13 - ${context.length * 4}`,
        ...context.map((register, index) => `sw [r13 + ${index * 4}], ${register}`),
        'jmp __irq_handler, r14',
        ...context.map((register, index) => `lw ${register}, [r13 + ${index * 4}]`),
        `mov r13, r13 + ${context.length * 4}`,
        'mov r1, r1 | 1',
        'jmp r3',
    );
    return assembleToObject(lines.join('\n'), { exports: [entry] });
}
