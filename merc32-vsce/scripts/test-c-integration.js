const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const { compileC, compileCFile, compileCToObject, compileCFileToObject } = require('../out/cCompiler');
const { linkObjects } = require('../out/linker');
const { SimpleCPUAssembler } = require('../out/assembler');

const source = 'int included(void) { return 7; }\nint main(void) { return included(); }\n';
const legacy = compileC(source, { moduleName: 'legacy_api' });
assert.strictEqual(typeof legacy.assembly, 'string', 'compileC must continue returning assembly');
assert.ok(compileCFile, 'compileCFile must remain available to legacy callers');

const object = compileCToObject(source, { moduleName: 'object_api' });
assert.strictEqual(object.version, 1, 'compileCToObject must return versioned MERC32 objects');
assert.strictEqual(object.target, 'merc32');
assert.strictEqual(object.abi, 'merc32-c-v1');
assert.strictEqual(typeof object.sections[0].content, 'string');
assert.deepStrictEqual(
    object.symbols.filter((symbol) => symbol.defined).map((symbol) => symbol.name),
    ['included', 'main'],
    'typed object generation must publish each function definition',
);
assert.ok(object.relocations.some((relocation) =>
    relocation.kind === 'CALL16' && relocation.symbol === 'included'
), 'typed object generation must retain direct-call relocations');

const linkedObject = linkObjects([object]);
assert.strictEqual(linkedObject.symbols.get('included'), 0);
assert.ok(linkedObject.symbols.get('main') > linkedObject.symbols.get('included'));
assert.match(linkedObject.assembly, /mov r4, 7/, 'typed lowering must preserve scalar return values');
assert.match(linkedObject.assembly, /jmp included, r14/, 'typed lowering must preserve direct calls');

const scalarSource = `
int scale(int left, int right) {
    int local = left;
    local = local + right * 2;
    return local;
}

int main(void) {
    int result = scale(3, 4);
    result = result + 1;
    return result;
}
`;
const scalarObject = compileCToObject(scalarSource, { moduleName: 'typed_scalar_api' });
const scalarAssembly = linkObjects([scalarObject]).assembly;
assert.deepStrictEqual(
    scalarObject.symbols.filter((symbol) => symbol.defined).map((symbol) => symbol.name),
    ['scale', 'main'],
    'typed objects must define scalar functions with parameters and locals',
);
assert.ok(scalarObject.relocations.some((relocation) =>
    relocation.kind === 'CALL16' && relocation.symbol === 'scale'
), 'typed objects must retain parameterized direct-call relocations');
assert.match(scalarAssembly, /sw \[r12 \+ 8\], r4/, 'typed ABI must spill the first scalar parameter');
assert.match(scalarAssembly, /sw \[r12 \+ 12\], r5/, 'typed ABI must spill the second scalar parameter');
assert.match(scalarAssembly, /mul r\d+, r\d+, r\d+/, 'typed lowering must preserve scalar multiplication');
assert.match(scalarAssembly, /mov r\d+, r\d+ \+ r\d+/, 'typed lowering must preserve scalar addition and assignment');
assert.ok(new SimpleCPUAssembler().assemble(scalarAssembly, {
    sourceFileName: 'typed_scalar_api.asm',
}).machineCodes.length > 0, 'typed scalar object assembly must remain assembleable');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-c-integration-'));
try {
    const header = path.join(root, 'included.h');
    const entry = path.join(root, 'main.c');
    fs.writeFileSync(header, 'int included(int left, int right) { int local = left; local = local + right; return local; }\n');
    fs.writeFileSync(entry, '#include "included.h"\nint main(void) { int result = included(3, 4); result = result + 1; return result; }\n');

    const legacyFile = compileCFile(entry, { moduleName: 'legacy_file_api' });
    assert.strictEqual(typeof legacyFile.assembly, 'string', 'compileCFile must continue returning assembly');

    const preprocessedObject = compileCFileToObject(entry, { moduleName: 'preprocessed_object' });
    assert.deepStrictEqual(
        preprocessedObject.symbols.filter((symbol) => symbol.defined).map((symbol) => symbol.name),
        ['included', 'main'],
    );
    assert.ok(preprocessedObject.relocations.some((relocation) => relocation.symbol === 'included'));
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
