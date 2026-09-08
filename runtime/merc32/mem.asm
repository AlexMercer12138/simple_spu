.text
// Leaf ABI: r4-r8 are scratch; r4 holds the result, r14 the return address.
memcpy:
  mov r7, r4
__merc32_memcpy_loop:
  bz r6, r0 + __merc32_memcpy_done
  lbu r8, [r5]
  sb [r7], r8
  mov r5, r5 + 1
  mov r7, r7 + 1
  mov r6, r6 - 1
  jmp __merc32_memcpy_loop
__merc32_memcpy_done:
  jmp r14

memmove:
  bz r6, r0 + __merc32_memmove_done
  cmpu r7, r4 <= r5
  bnz r7, r0 + memcpy
  // Copy from the end whenever destination follows source, including overlap.
  mov r7, r4 + r6
  mov r5, r5 + r6
__merc32_memmove_backward:
  mov r7, r7 - 1
  mov r5, r5 - 1
  lbu r8, [r5]
  sb [r7], r8
  mov r6, r6 - 1
  bnz r6, r0 + __merc32_memmove_backward
__merc32_memmove_done:
  jmp r14

memset:
  mov r7, r4
__merc32_memset_loop:
  bz r6, r0 + __merc32_memset_done
  sb [r7], r5
  mov r7, r7 + 1
  mov r6, r6 - 1
  jmp __merc32_memset_loop
__merc32_memset_done:
  jmp r14

memcmp:
  bz r6, r0 + __merc32_memcmp_equal
__merc32_memcmp_loop:
  lbu r7, [r4]
  lbu r8, [r5]
  mov r7, r7 - r8
  bnz r7, r0 + __merc32_memcmp_different
  mov r4, r4 + 1
  mov r5, r5 + 1
  mov r6, r6 - 1
  bnz r6, r0 + __merc32_memcmp_loop
__merc32_memcmp_equal:
  mov r4, 0
  jmp r14
__merc32_memcmp_different:
  mov r4, r7
  jmp r14

strlen:
  mov r5, r4
__merc32_strlen_loop:
  lbu r7, [r5]
  bz r7, r0 + __merc32_strlen_done
  mov r5, r5 + 1
  jmp __merc32_strlen_loop
__merc32_strlen_done:
  mov r4, r5 - r4
  jmp r14

strcmp:
__merc32_strcmp_loop:
  lbu r7, [r4]
  lbu r8, [r5]
  mov r6, r7 - r8
  bnz r6, r0 + __merc32_strcmp_done
  bz r7, r0 + __merc32_strcmp_done
  mov r4, r4 + 1
  mov r5, r5 + 1
  jmp __merc32_strcmp_loop
__merc32_strcmp_done:
  mov r4, r6
  jmp r14
