'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    compileC,
    compileCFileDetailed,
    getCCompileSourceFiles,
} = require('../out/cCompiler');

function assertCompiles(source, options = {}) {
    const result = compileC(source, options);
    assert.equal(typeof result.assembly, 'string');
    return result;
}

// Aro owns macro expansion, including token pasting, stringizing, variadics,
// and conditional branches. Keep these as backend-facing regression inputs.
assertCompiles([
    '#define VALUE 7',
    '#define CAT(left, right) left##right',
    '#define STRINGIFY(value) #value',
    '#define SUM(first, ...) first + __VA_ARGS__',
    'int valuename = VALUE;',
    'char *text = STRINGIFY(hello);',
    'int main(void) { return SUM(CAT(value, name), 2); }',
].join('\n'), { moduleName: 'aro_macros' });

assert.match(assertCompiles([
    '#if defined(ENABLED) && ENABLED',
    'int main(void) { return 3; }',
    '#else',
    'int main(void) { return 9; }',
    '#endif',
].join('\n'), { defines: { ENABLED: '1' }, moduleName: 'aro_conditionals' }).assembly, /mov r4, 3/);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-aro-source-provider-'));
try {
    const header = path.join(root, 'values.h');
    const entry = path.join(root, 'main.c');
    fs.writeFileSync(header, '#define VALUE 11\n', 'utf8');
    fs.writeFileSync(entry, '#include "values.h"\nint main(void) { return VALUE; }\n', 'utf8');

    const included = compileCFileDetailed(entry, { moduleName: 'aro_file' });
    assert.ok(included.artifact, 'Aro file compilation must resolve quoted includes');
    assert.ok(getCCompileSourceFiles(included).some((file) => file.path === 'values.h'),
        'Aro source traces must retain included source files');

    const callbackFiles = new Map([
        [path.resolve(entry), '#include "values.h"\nint main(void) { return VALUE; }\n'],
        [path.resolve(header), '#define VALUE 12\n'],
    ]);
    const callbackResult = compileCFileDetailed(entry, {
        moduleName: 'aro_callbacks',
        preprocess: {
            realPath: (file) => file,
            readFile: (file) => {
                const source = callbackFiles.get(path.resolve(file));
                if (source === undefined) throw new Error(`missing callback source: ${file}`);
                return source;
            },
        },
    });
    assert.ok(callbackResult.artifact, 'compatibility readFile/realPath callbacks must feed Aro');

    fs.writeFileSync(path.join(root, 'cycle-a.h'), '#include "cycle-b.h"\n', 'utf8');
    fs.writeFileSync(path.join(root, 'cycle-b.h'), '#include "cycle-a.h"\n', 'utf8');
    const cycleMain = path.join(root, 'cycle.c');
    fs.writeFileSync(cycleMain, '#include "cycle-a.h"\nint main(void) { return 0; }\n', 'utf8');
    const cycle = compileCFileDetailed(cycleMain);
    assert.equal(cycle.artifact, undefined);
    assert.ok(cycle.diagnostics.some((diagnostic) => /include nested too deeply|include cycle/i.test(diagnostic.message)),
        'Aro must report recursive include depth/cycle diagnostics');

    fs.writeFileSync(path.join(root, 'depth-a.h'), '#include "depth-b.h"\n', 'utf8');
    fs.writeFileSync(path.join(root, 'depth-b.h'), 'int value = 1;\n', 'utf8');
    const depthMain = path.join(root, 'depth.c');
    fs.writeFileSync(depthMain, '#include "depth-a.h"\nint main(void) { return value; }\n', 'utf8');
    const depth = compileCFileDetailed(depthMain, { preprocess: { maxIncludeDepth: 1 } });
    assert.equal(depth.artifact, undefined);
    assert.ok(depth.diagnostics.some((diagnostic) => /include nested too deeply/i.test(diagnostic.message)),
        'compatibility maxIncludeDepth must constrain Aro include traversal');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

console.log('Aro C source-provider/preprocessor tests passed.');
