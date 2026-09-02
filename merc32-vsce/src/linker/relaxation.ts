export interface InstructionRecord { readonly opcode: string; readonly target?: string; readonly condition?: string; readonly address: number; }
export function relaxControlFlow(records: readonly InstructionRecord[], symbols: ReadonlyMap<string, number>): InstructionRecord[] {
  return records.map(record => {
    if (!record.target) return record;
    const target = symbols.get(record.target);
    if (target === undefined) return record;
    const distance = target - record.address;
    if (Math.abs(distance) <= 0x7fff) return record;
    return { ...record, opcode: record.opcode === 'jmp' ? 'long-jmp' : 'long-branch' };
  });
}
