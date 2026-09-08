'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compileCFileDetailed, compileCToObjectDetailed } = require('../out/cCompiler');
const { runCases } = require('./c-execution');

const header = fs.readFileSync(path.join(__dirname, '../resources/c-frontend/include/merc32_irq.h'), 'utf8');
const options = { includePaths: ['include'], virtualFiles: [{ path: 'include/merc32_irq.h', source: header }] };
const declarations = `
#include <merc32_irq.h>
#include <merc32_irq.h>
void __irq_handler(void) {}
`;

runCases([
    { name: 'irq_nested_restore', source: `${declarations}
        int test(void) {
            __irq_enable_level();
            unsigned outer = (irq_save)();
            unsigned inner = irq_save();
            if (outer != 5 || inner != 4) return 1;
            irq_restore(inner);
            if (irq_save() != 4) return 2;
            (irq_restore)(outer);
            if (irq_save() != 5) return 3;
            __irq_disable();
            return 0;
        }
    ` },
    { name: 'irq_full_state_and_modes', source: `${declarations}
        int test(void) {
            irq_restore(0xa5a50005u);
            if (irq_save() != 0xa5a50005u) return 1;
            if (irq_save() != 0xa5a50004u) return 2;
            __irq_enable();
            if (irq_save() != 1) return 3;
            if (irq_save() != 0) return 4;
            __irq_enable_level();
            if (irq_save() != 5) return 5;
            __irq_disable();
            if (irq_save() != 0) return 6;
            return 0;
        }
    ` },
    { name: 'irq_restore_argument_once', source: `${declarations}
        int calls;
        unsigned state(void) { calls++; return 5; }
        int test(void) {
            irq_restore(state());
            unsigned saved = irq_save();
            if (saved != 5 || calls != 1) return 1;
            irq_restore(saved & ~1u);
            if (irq_save() != 4) return 2;
            return 0;
        }
    ` },
].map(test => ({ ...test, options })));

for (const call of ['irq_save(1)', 'irq_restore()', '__irq_enable(1)', '__irq_disable(1)',
    '__irq_enable_level(1)']) {
    const result = compileCToObjectDetailed(`${declarations}\nint main(void) { ${call}; return 0; }`, options);
    assert.equal(result.artifact, undefined, `${call} must reject invalid intrinsic arguments`);
    assert(result.diagnostics.some(diagnostic => diagnostic.severity === 'error' || diagnostic.severity === 'fatal'));
}

for (const source of [
    'int irq_save(void); int main(void) { return irq_save(); }',
    'void irq_restore(int state); int main(void) { irq_restore(0); return 0; }',
    'unsigned irq_save(int unused); int main(void) { return 0; }',
    'int __irq_enable(void); int main(void) { return 0; }',
    'void __irq_disable(int unused); int main(void) { return 0; }',
    'unsigned irq_save(void) { return 1; } int main(void) { return 0; }',
    `${declarations} unsigned (*saved)(void) = irq_save; int main(void) { return 0; }`,
    `${declarations} int main(void) { unsigned (*saved)(void) = irq_save; return saved(); }`,
]) {
    const result = compileCToObjectDetailed(source, options);
    assert.equal(result.artifact, undefined, 'invalid IRQ declaration or function address must be rejected');
    assert(result.diagnostics.some(diagnostic => diagnostic.code === 'C_BACKEND_CAPABILITY'),
        JSON.stringify(result.diagnostics));
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-irq-header-'));
try {
    const source = path.join(temporary, 'main.c');
    fs.writeFileSync(source, `${declarations}\nint main(void) { irq_restore(irq_save()); return 0; }`);
    const result = compileCFileDetailed(source);
    assert.ok(result.artifact, `packaged IRQ header: ${JSON.stringify(result.diagnostics)}`);
} finally {
    fs.rmSync(temporary, { recursive: true, force: true });
}

console.log('IRQ intrinsic C execution tests passed');
