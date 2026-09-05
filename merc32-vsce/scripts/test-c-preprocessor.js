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

    const callbackEntry = path.join(root, 'callback-entry.c');
    const callbackHeader = path.join(root, 'callback-header.h');
    const callbackFiles = new Map([
        [path.resolve(callbackEntry), '#include "callback-header.h"\nint main(void) { return VALUE; }\n'],
        [path.resolve(callbackHeader), '#define VALUE 12\n#warning callback-header\n'],
    ]);
    const callbackResult = compileCFileDetailed(callbackEntry, {
        moduleName: 'aro_callbacks',
        preprocess: {
            realPath: (file) => path.resolve(file),
            readFile: (file) => {
                const source = callbackFiles.get(path.resolve(file));
                if (source === undefined) throw new Error(`missing callback source: ${file}`);
                return source;
            },
        },
    });
    assert.ok(callbackResult.artifact, 'compatibility readFile/realPath callbacks must feed Aro');
    assert.ok(callbackResult.diagnostics.some((diagnostic) => /callback-header/u.test(diagnostic.message)),
        'callback-only header content must reach Aro diagnostics');
    assert.ok(getCCompileSourceFiles(callbackResult).some((file) => file.path === 'callback-header.h'),
        'callback-only include must appear in the Aro source trace');

    fs.writeFileSync(path.join(root, 'cycle-a.h'), '#include "cycle-b.h"\n', 'utf8');
    fs.writeFileSync(path.join(root, 'cycle-b.h'), '#include "cycle-a.h"\n', 'utf8');
    const cycleMain = path.join(root, 'cycle.c');
    fs.writeFileSync(cycleMain, '#include "cycle-a.h"\nint main(void) { return 0; }\n', 'utf8');
    const cycle = compileCFileDetailed(cycleMain);
    assert.equal(cycle.artifact, undefined);
    const cycleDiagnostic = cycle.diagnostics.find((diagnostic) => /include nested too deeply|include cycle/i.test(diagnostic.message));
    assert.ok(cycleDiagnostic, 'Aro must report recursive include cycles');
    assert.ok(cycleDiagnostic.includeTrace.length > 1,
        'include-cycle diagnostics must retain the repeated include trace');

    fs.writeFileSync(path.join(root, 'depth-a.h'), '#include "depth-b.h"\n', 'utf8');
    fs.writeFileSync(path.join(root, 'depth-b.h'), 'int value = 1;\n', 'utf8');
    const depthMain = path.join(root, 'depth.c');
    fs.writeFileSync(depthMain, '#include "depth-a.h"\nint main(void) { return value; }\n', 'utf8');
    const depth = compileCFileDetailed(depthMain, { preprocess: { maxIncludeDepth: 1 } });
    assert.equal(depth.artifact, undefined);
    const depthDiagnostic = depth.diagnostics.find((diagnostic) => /include nested too deeply/i.test(diagnostic.message));
    assert.ok(depthDiagnostic, 'compatibility maxIncludeDepth must constrain Aro include traversal');
    assert.ok(depthDiagnostic.includeTrace.length < cycleDiagnostic.includeTrace.length,
        'max-depth diagnostics must retain their shorter include trace');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

console.log('Aro C source-provider/preprocessor tests passed.');
