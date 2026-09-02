const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const { compileC, compileCFile, compileCToObject, compileCFileToObject } = require('../out/cCompiler');

const source = 'int main(void) { return 0; }\n';
const legacy = compileC(source, { moduleName: 'legacy_api' });
assert.strictEqual(typeof legacy.assembly, 'string', 'compileC must continue returning assembly');
assert.ok(compileCFile, 'compileCFile must remain available to legacy callers');

const object = compileCToObject(source, { moduleName: 'object_api' });
assert.strictEqual(object.version, 1, 'compileCToObject must return versioned MERC32 objects');
assert.strictEqual(object.target, 'merc32');
assert.strictEqual(object.abi, 'merc32-c-v1');
assert.strictEqual(typeof object.sections[0].content, 'string');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-c-integration-'));
try {
    const header = path.join(root, 'included.h');
    const entry = path.join(root, 'main.c');
    fs.writeFileSync(header, 'int included(void) { return 7; }\n');
    fs.writeFileSync(entry, '#include "included.h"\nint main(void) { return included(); }\n');

    const legacyFile = compileCFile(entry, { moduleName: 'legacy_file_api' });
    assert.strictEqual(typeof legacyFile.assembly, 'string', 'compileCFile must continue returning assembly');

    const preprocessedObject = compileCFileToObject(entry, { moduleName: 'preprocessed_object' });
    assert.ok(preprocessedObject.debug.some((location) =>
        location.file === fs.realpathSync(header) && location.line === 1 && location.column === 1,
    ), 'object debug locations must retain included-source origins after preprocessing');

    const originalLoad = Module._load;
    Module._load = function loadVscode(request, parent, isMain) {
        if (request === 'vscode') {
            return {
                workspace: {
                    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
                },
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        const { buildCFileToRom } = require('../out/compilerService');
        const result = buildCFileToRom(entry, 'normal');
        assert.deepStrictEqual(result.artifacts.map((artifact) => artifact.label), ['main.asm', 'main.v']);
    } finally {
        Module._load = originalLoad;
    }
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

console.log('C public API integration tests passed');
