; MERC32 startup ABI v1. The linker resolves __stack_top and main.
.text
startup:
  jmp main, r14
halt:
  jmp halt, r14
