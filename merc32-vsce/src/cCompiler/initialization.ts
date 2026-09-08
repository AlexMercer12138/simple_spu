import { IRInstruction } from './ir';

// Literal count/offset operands keep fill loops independent of initializer size.
export function emitByteInitialization(instructions: IRInstruction[], allocate: () => number, base: number,
    size: number, bytes: readonly number[] | undefined, volatile: boolean,
    location?: IRInstruction['location'], skipped: readonly { offset: number; size: number }[] = []): void {
    const constant = (value: number): number => {
        const dest = allocate(); instructions.push({ op: 'constant', args: [value], dest, location }); return dest;
    };
    const reserved = (offset: number): boolean => skipped.some(span => offset >= span.offset && offset < span.offset + span.size);
    for (let offset = 0; offset < size;) {
        if (reserved(offset)) { offset++; continue; }
        const byte = bytes?.[offset] ?? 0;
        let end = offset + 1;
        while (end < size && !reserved(end) && (bytes?.[end] ?? 0) === byte) end++;
        const value = constant(byte);
        if (end - offset >= 8) {
            instructions.push({ op: 'fill-memory', args: [base, value, end - offset, offset], volatile, location });
        } else {
            for (let at = offset; at < end; at++) {
                let address = base;
                if (at !== 0) {
                    const relative = constant(at); address = allocate();
                    instructions.push({ op: 'binary', args: ['+', base, relative], dest: address, location });
                }
                instructions.push({ op: 'store-memory', args: [address, value, 1], volatile, location });
            }
        }
        offset = end;
    }
}
