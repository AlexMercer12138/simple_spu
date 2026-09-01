const RESERVED = new Set(['r0', 'r1', 'r2', 'r3', 'r12', 'r13', 'r14', 'r15']);

export class VirtualRegisterAllocator {
  private next = 0;
  private readonly free: number[] = [];
  private spills = 0;
  isReserved(register: string): boolean { return RESERVED.has(register); }
  allocate(): number { return this.free.pop() ?? this.next++; }
  release(register: number): void { if (register >= 0) this.free.push(register); }
  spillSlot(): number { return this.spills++; }
  get spillCount(): number { return this.spills; }
}
