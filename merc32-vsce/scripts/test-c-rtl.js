'use strict';

// The handwritten Tiny C firmware corpus is no longer a supported frontend
// input. Reuse the Aro-owned typed RTL execution harness for this command so
// the public C RTL gate still exercises compilation, linking, assembly, and
// simulation through the supported path.
require('./test-c-typed-rtl');

console.log('MERC32 Aro C RTL suite passed');
