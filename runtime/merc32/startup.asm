; MERC32 startup ABI v1. The default DLB stack top is 0x08040000.
.text
startup:
  mov r13, 0x804
  mov r13, r13 << 16
  jmp __merc32_init_globals, r14
  jmp main, r14
halt:
  jmp halt, r14
