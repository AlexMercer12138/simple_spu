const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const {
    compileC,
    compileCFile,
    compileCToObject,
    compileCToObjectDetailed,
    compileCFileToObject,
    compileCFileToObjectDetailed,
    splitCompileOptions,
    analyzeTranslationUnit,
    lowerProgram,
    loadRuntimeObjects,
    parseTranslationUnit,
    tokenizeC,
} = require('../out/cCompiler');
const { linkObjects } = require('../out/linker');
const { SimpleCPUAssembler } = require('../out/assembler');

function functionAssemblyBody(assembly, functionName) {
    const body = assembly.match(
        new RegExp(`^${functionName}:\\r?\\n([\\s\\S]*?)^(?:__mobj_\\d+_)?__${functionName}_return(?:_\\d+)?:`, 'm'),
    )?.[1];
    assert.ok(body, `missing assembly body for ${functionName}`);
    return body;
}

const source = 'int included(void) { return 7; }\nint main(void) { return included(); }\n';
const legacy = compileC(source, { moduleName: 'legacy_api' });
assert.strictEqual(typeof legacy.assembly, 'string', 'compileC must continue returning assembly');
assert.match(legacy.assembly, /\.entry __start/, 'legacy public compile must retain startup entry');
assert.ok(compileCFile, 'compileCFile must remain available to legacy callers');

const object = compileCToObject(source, { moduleName: 'object_api' });
assert.strictEqual(object.version, 1, 'compileCToObject must return versioned MERC32 objects');
const detailedObject = compileCToObjectDetailed('int main(void) { return 3; }', {
    sourceName: 'main.c',
    defines: { ENABLED: '1' },
    moduleName: 'detailed_object',
});
assert.strictEqual(detailedObject.artifact.target, 'merc32');
assert.deepStrictEqual(detailedObject.diagnostics.filter((item) => item.severity === 'error'), []);
for (const [name, expression] of [
    ['parentheses', '(1 + 2)'],
    ['same-width explicit cast', '(unsigned int)value'],
]) {
    const parameters = name === 'parentheses' ? 'void' : 'int value';
    const result = compileCToObjectDetailed(`unsigned int probe(${parameters}) { return ${expression}; }`, {
        sourceName: `${name.replaceAll(' ', '-')}.c`,
    });
    assert(result.artifact, `${name} must compile through the real Aro WASM object path`);
    assert.deepStrictEqual(result.diagnostics.filter((item) => item.severity === 'error'), []);
}
const narrowingCast = compileCToObjectDetailed(
    'unsigned char probe(int value) { return (unsigned char)value; }',
    { sourceName: 'narrowing-cast.c' },
);
assert.strictEqual(narrowingCast.artifact, undefined);
assert(narrowingCast.diagnostics.some((item) => item.code === 'C_BACKEND_CAPABILITY'
    && /narrowing or widening explicit casts/u.test(item.message)),
    'unsupported-width explicit casts must return a backend capability diagnostic');
const split = splitCompileOptions({
    sourceName: 'main.c', defines: { VALUE: '3' }, includePaths: ['include'],
    dataBase: 0x08000000, dlbAddrWidth: 16, codeBase: 0, moduleName: 'split', tempSlots: 9,
});
assert.deepStrictEqual(Object.keys(split.frontend).sort(), ['defines', 'includePaths', 'sourceName']);
assert.deepStrictEqual(Object.keys(split.backend).sort(), [
    'codeBase', 'dataBase', 'dlbAddrWidth', 'moduleName', 'tempSlots',
]);
assert.throws(
    () => compileCToObject('int main( { return 0; }'),
    (error) => error && error.name === 'CFrontendError'
        && Array.isArray(error.diagnostics) && error.diagnostics.length > 0,
);
assert.strictEqual(object.target, 'merc32');
assert.strictEqual(object.abi, 'merc32-c-v1');
assert.strictEqual(typeof object.sections[0].content, 'string');
assert.deepStrictEqual(
    object.symbols.filter((symbol) => symbol.defined && symbol.binding === 'global').map((symbol) => symbol.name),
    ['included', 'main', '__merc32_init_globals'],
    'typed object generation must publish each function definition and its runtime initializer entry',
);
assert.ok(object.relocations.some((relocation) =>
    relocation.kind === 'CALL16' && relocation.symbol === 'included'
), 'typed object generation must retain direct-call relocations');

const startupObject = loadRuntimeObjects().find((runtimeObject) =>
    runtimeObject.symbols.some((symbol) => symbol.name === 'startup' && symbol.defined)
);
assert.ok(startupObject, 'runtime catalog must provide startup');
const startupLinkedObject = linkObjects([startupObject, object], { entrySymbol: 'startup' });
assert.strictEqual(startupLinkedObject.entryAddress, 0,
    'typed objects without globals must still satisfy the runtime global initializer contract');

const linkedObject = linkObjects([object], { entrySymbol: 'main' });
assert.strictEqual(linkedObject.symbols.get('included'), 0);
assert.ok(linkedObject.symbols.get('main') > linkedObject.symbols.get('included'));
assert.strictEqual(linkedObject.entryAddress, linkedObject.symbols.get('main'));
assert.match(linkedObject.assembly, /mov r4, 7/, 'typed lowering must preserve scalar return values');
assert.match(linkedObject.assembly, /jmp 0x0, r14/, 'typed lowering must resolve direct calls to absolute targets');

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
    scalarObject.symbols.filter((symbol) => symbol.defined && symbol.binding === 'global').map((symbol) => symbol.name),
    ['scale', 'main', '__merc32_init_globals'],
    'typed objects must define scalar functions with parameters, locals, and runtime initialization',
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

const manyArgumentObject = compileCToObject(`
int five(int a, int b, int c, int d, int e) { return a + b + c + d + e; }
int main(void) { return five(1, 2, 3, 4, 5); }
`, { moduleName: 'typed_many_argument_api' });
const manyArgumentAssembly = linkObjects([manyArgumentObject]).assembly;
const manyArgumentBody = functionAssemblyBody(manyArgumentAssembly, 'main');
const fourthRegisterIndex = manyArgumentBody.indexOf('mov r7, [r12 +');
const stackArgumentIndex = manyArgumentBody.indexOf('mov r13, r13 - 4');
assert.ok(stackArgumentIndex >= 0, 'typed calls with five arguments must allocate caller stack storage');
assert.ok(fourthRegisterIndex >= 0 && fourthRegisterIndex > stackArgumentIndex,
    'typed call argument setup must load the fourth register argument after the stack area staging');
assert.match(manyArgumentBody, /mov r13, r13 - 4\r?\n\s*mov r7, \[r12 \+ \d+\]\r?\n\s*sw \[r13 \+ 0\], r7/,
    'typed fifth argument must be written through the caller SP argument area');
const manyArgumentCallOffset = manyArgumentObject.relocations.find((relocation) => relocation.symbol === 'five')?.offset;
assert.strictEqual(typeof manyArgumentCallOffset, 'number');
const manyArgumentInstructionOffset = manyArgumentAssembly
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:mov|lb|lbu|lh|lhu|lw|sb|sh|sw|jmp|bz|bnz|cmp|mul|div|rem):?/.test(line))
    .findIndex((line) => line.trim() === 'jmp 0x0, r14') * 4;
assert.strictEqual(manyArgumentCallOffset, manyArgumentInstructionOffset,
    'typed call relocation must identify the resolved call instruction, after argument setup');

const initializedGlobalObject = compileCToObject('int global_value = 3; int main(void) { return global_value; }');
assert.deepStrictEqual(
    initializedGlobalObject.sections.find((section) => section.name === 'data').content,
    [3, 0, 0, 0],
    'typed initialized globals must preserve their little-endian data image',
);
assert.ok(initializedGlobalObject.symbols.some((symbol) =>
    symbol.name === 'global_value' && symbol.defined && symbol.section === 'data'
), 'typed initialized globals must publish data symbols');
assert.ok(initializedGlobalObject.symbols.some((symbol) =>
    symbol.name === '__merc32_init_globals' && symbol.defined && symbol.section === 'text'
), 'typed global objects must publish their startup initialization function');
const aggregateGlobalObject = compileCToObject(`
struct Record { char tag; int value; };
struct Record global_record = { .value = 0x11223344, .tag = 5 };
int global_values[4] = { [1] = 7, 8, [3] = 9 };
int main(void) { return global_record.value + global_values[2]; }
`);
assert.deepStrictEqual(
    aggregateGlobalObject.sections.find((section) => section.name === 'data').content,
    [
        5, 0, 0, 0, 0x44, 0x33, 0x22, 0x11,
        0, 0, 0, 0, 7, 0, 0, 0, 8, 0, 0, 0, 9, 0, 0, 0,
    ],
    'typed aggregate globals must honor field/index designators, layout padding, and zero fill',
);
const braceElisionObject = compileCToObject(`
int flattened[2][2] = { 1, 2, 3, 4 };
int continued[2][2] = { [0][1] = 5, 6, 7 };
int mixed[2][2] = { 1, { 2 }, 3, 4 };
`);
assert.deepStrictEqual(
    braceElisionObject.sections.find((section) => section.name === 'data').content,
    [
        1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0,
        0, 0, 0, 0, 5, 0, 0, 0, 6, 0, 0, 0, 7, 0, 0, 0,
        2, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0,
    ],
    'typed aggregate globals must brace-elide nested arrays and continue after chained designators',
);
const inferredArrayObject = compileCToObject(`
int values[] = { 1, 2 };
char message[] = "hi";
int inferred[][2] = { 1, 2, 3, 4 };
`);
assert.deepStrictEqual(
    inferredArrayObject.sections.find((section) => section.name === 'data').content,
    [
        1, 0, 0, 0, 2, 0, 0, 0, 104, 105, 0, 0,
        1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0,
    ],
    'typed aggregate globals must infer list and string array bounds before lowering',
);
const designatedInferredArrayObject = compileCToObject('int inferred[][2] = { [1] = { 1, 2 }, 3 };');
assert.deepStrictEqual(
    designatedInferredArrayObject.sections.find((section) => section.name === 'data').content,
    [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0],
    'typed aggregate globals must continue after designated braced inferred array elements',
);
assert.throws(
    () => compileCToObject('float add(float left, float right) { return left + right; }'),
    /float operations are not supported by the MERC32 backend/,
    'typed object generation must reject unsupported floating bodies instead of integer lowering',
);
assert.strictEqual(
    compileCToObject('int main(void) { return 0; }', { dataBase: 0x08000100, dlbAddrWidth: 8 }).target,
    'merc32',
    'object compilation must keep linker-only layout options out of the Aro bridge request',
);
assert.strictEqual(
    compileCToObject('typedef int word; int main(void) { word value = 3; return value; }').symbols
        .some((symbol) => symbol.name === 'main' && symbol.defined),
    true,
    'typed object generation must retain supported scalar typedefs',
);
assert.throws(
    () => compileCToObject('long long value(void) { return 0; }'),
    /long long operations are not supported by the MERC32 backend/,
    'typed object generation must reject 64-bit values until pair lowering is wired',
);

const controlSource = `
int control(int value) {
    int total = 0;
    if (value && value > 1) {
        total = value;
    } else {
        total = 1;
    }
    while (total < 4) {
        total = total + 1;
        if (total == 3) continue;
        if (total == 4) break;
    }
    for (int i = 0; i < 1; i = i + 1) {
        total = total || i;
    }
    return total;
}
`;
const controlObject = compileCToObject(controlSource, { moduleName: 'typed_control_api' });
const controlAssembly = linkObjects([controlObject]).assembly;
assert.match(controlAssembly, /__control_else_|__control_while_|__control_for_/,
    'typed control-flow lowering must emit branch labels');
assert.doesNotMatch(controlAssembly, /does not support '&&'|does not support '\|\|'/,
    'typed logical operators must lower without unsupported-operator errors');
assert.ok(new SimpleCPUAssembler().assemble(controlAssembly, {
    sourceFileName: 'typed_control_api.asm',
}).machineCodes.length > 0, 'typed control-flow object assembly must remain assembleable');

const doWhileSource = `
int typed_do(int limit) {
    int count = 0;
    do {
        count = count + 1;
        if (count < limit) continue;
        count = count + 10;
    } while (count < 3);
    return count;
}
`;
const doWhileAssembly = linkObjects([
    compileCToObject(doWhileSource, { moduleName: 'typed_do_while_api' }),
]).assembly;
const doWhileBody = functionAssemblyBody(doWhileAssembly, 'typed_do');
const doBodyLabel = doWhileBody.match(/^((?:__mobj_\d+_)?__typed_do_do_body_\d+):$/m)?.[1];
const doConditionLabel = doWhileBody.match(/^((?:__mobj_\d+_)?__typed_do_do_condition_\d+):$/m)?.[1];
assert.ok(doBodyLabel && doConditionLabel, 'typed do/while must emit body and condition labels');
assert.ok(
    doWhileBody.indexOf(`${doBodyLabel}:`) < doWhileBody.indexOf(`${doConditionLabel}:`),
    'typed do/while must enter the body before testing its condition',
);
assert.match(
    doWhileBody,
    new RegExp(`^\\s*jmp ${doConditionLabel}$`, 'm'),
    'continue in typed do/while must target the condition',
);
assert.match(
    doWhileBody,
    new RegExp(`^\\s*bnz r7, r0 \\+ ${doBodyLabel}$`, 'm'),
    'typed do/while must branch back to the body when its condition is true',
);
assert.ok(new SimpleCPUAssembler().assemble(doWhileAssembly, {
    sourceFileName: 'typed_do_while_api.asm',
}).machineCodes.length > 0, 'typed do/while object assembly must remain assembleable');

const emptyControlAssembly = linkObjects([compileCToObject(`
int typed_empty_control(int value) {
empty_label:
    ;
    do ; while (0);
    switch (value) {
    case 0:
        ;
    default:
        ;
    }
    return value;
}
`, { moduleName: 'typed_empty_control_api' })]).assembly;
assert.ok(new SimpleCPUAssembler().assemble(emptyControlAssembly, {
    sourceFileName: 'typed_empty_control_api.asm',
}).machineCodes.length > 0, 'typed labels and control flow must accept empty statements');

const switchSource = `
int typed_switch_loop(int value) {
    int result = 0;
    while (value < 3) {
        switch (value) {
        case 0:
            result = result + 1;
        case 1:
            value = value + 1;
            continue;
        default:
            result = result + 4;
            break;
        }
        result = result + 8;
        break;
    }
    return result;
}
`;
const switchAssembly = linkObjects([
    compileCToObject(switchSource, { moduleName: 'typed_switch_api' }),
]).assembly;
const switchBody = functionAssemblyBody(switchAssembly, 'typed_switch_loop');
const outerWhileLabel = switchBody.match(/^((?:__mobj_\d+_)?__typed_switch_loop_while_\d+):$/m)?.[1];
const outerWhileEndLabel = switchBody.match(/^((?:__mobj_\d+_)?__typed_switch_loop_endwhile_\d+):$/m)?.[1];
const switchEndLabel = switchBody.match(/^((?:__mobj_\d+_)?__typed_switch_loop_switch_end_\d+):$/m)?.[1];
const switchCaseLabels = [...switchBody.matchAll(/^((?:__mobj_\d+_)?__typed_switch_loop_(?:switch_)?case_\d+):$/gm)]
    .map((match) => match[1]);
const switchDefaultLabel = switchBody.match(/^((?:__mobj_\d+_)?__typed_switch_loop_(?:switch_)?default_\d+):$/m)?.[1];
assert.ok(outerWhileLabel && outerWhileEndLabel && switchEndLabel && switchDefaultLabel);
assert.strictEqual(switchCaseLabels.length, 2, 'typed switch must emit one target per case');
assert.doesNotMatch(
    switchBody.slice(
        switchBody.indexOf(`${switchCaseLabels[0]}:`),
        switchBody.indexOf(`${switchCaseLabels[1]}:`),
    ),
    /^\s*jmp /m,
    'typed switch cases must retain source fallthrough',
);
assert.ok(
    (switchBody.match(new RegExp(`^\\s*jmp ${outerWhileLabel}$`, 'gm')) || []).length >= 2,
    'continue inside typed switch must target the surrounding loop',
);
assert.match(
    switchBody,
    new RegExp(`^\\s*jmp ${switchEndLabel}$`, 'm'),
    'break inside typed switch must target the switch end',
);
assert.match(
    switchBody,
    new RegExp(`^\\s*jmp ${outerWhileEndLabel}$`, 'm'),
    'break after typed switch must still target the surrounding loop end',
);
assert.ok(new SimpleCPUAssembler().assemble(switchAssembly, {
    sourceFileName: 'typed_switch_api.asm',
}).machineCodes.length > 0, 'typed switch object assembly must remain assembleable');
assert.throws(
    () => compileCToObject('int main(void) { switch (0) { case 1: break; case 1 + 0: break; } return 0; }'),
    /duplicate case value/,
    'typed switch must reject duplicate constant case values',
);
assert.throws(
    () => compileCToObject('int main(void) { switch (0) { default: break; default: break; } return 0; }'),
    /multiple default (?:labels|cases)/,
    'typed switch must reject multiple default labels',
);

const gotoSource = `
int typed_goto(int value) {
    goto forward;
backward:
    value = value + 1;
    goto done;
forward:
    value = value + 2;
    if (value < 3) goto backward;
done:
    return value;
}
`;
const gotoAssembly = linkObjects([
    compileCToObject(gotoSource, { moduleName: 'typed_goto_api' }),
]).assembly;
const gotoBody = functionAssemblyBody(gotoAssembly, 'typed_goto');
const gotoUserLabels = [...gotoBody.matchAll(/^((?:__mobj_\d+_)?__[A-Za-z0-9_]*_user_[A-Za-z0-9_]+):$/gm)]
    .map((match) => match[1]);
assert.strictEqual(gotoUserLabels.length, 3, 'typed labels must be function-scoped assembly labels');
const [backwardLabel, forwardLabel, doneLabel] = gotoUserLabels;
const forwardJumpIndex = gotoBody.indexOf(`jmp ${forwardLabel}`);
const forwardLabelIndex = gotoBody.indexOf(`${forwardLabel}:`);
assert.ok(
    forwardJumpIndex >= 0 && forwardJumpIndex < forwardLabelIndex,
    'typed goto must resolve a forward label',
);
const backwardJumpIndex = gotoBody.lastIndexOf(`jmp ${backwardLabel}`);
const backwardLabelIndex = gotoBody.indexOf(`${backwardLabel}:`);
assert.ok(
    backwardJumpIndex > backwardLabelIndex,
    'typed goto must resolve a backward label',
);
assert.ok(new SimpleCPUAssembler().assemble(gotoAssembly, {
    sourceFileName: 'typed_goto_api.asm',
}).machineCodes.length > 0, 'typed goto object assembly must remain assembleable');

const crossFunctionLabelsAssembly = linkObjects([compileCToObject(`
int a(void) {
    goto b_user_x;
b_user_x:
    return 1;
}
int a_user_b(void) {
    goto x;
x:
    return 2;
}
`, { moduleName: 'typed_cross_function_labels_api' })]).assembly;
assert.ok(new SimpleCPUAssembler().assemble(crossFunctionLabelsAssembly, {
    sourceFileName: 'typed_cross_function_labels_api.asm',
}).machineCodes.length > 0, 'typed labels from different functions must remain independently assembleable');

const rawGeneratedLabelCollisionAssembly = linkObjects([compileCToObject(`
int __1_a_user_1_x(void) { return 2; }
int a(void) {
    goto x;
x:
    return 1;
}
`, { moduleName: 'typed_raw_generated_label_collision_api' })]).assembly;
assert.ok(new SimpleCPUAssembler().assemble(rawGeneratedLabelCollisionAssembly, {
    sourceFileName: 'typed_raw_generated_label_collision_api.asm',
}).machineCodes.length > 0, 'typed generated user labels must be disjoint from raw function symbols');

const rawReturnLabelCollisionAssembly = linkObjects([compileCToObject(`
int __main_return(void) { return 2; }
int main(void) { return 1; }
`, { moduleName: 'typed_raw_return_label_collision_api' })]).assembly;
assert.ok(new SimpleCPUAssembler().assemble(rawReturnLabelCollisionAssembly, {
    sourceFileName: 'typed_raw_return_label_collision_api.asm',
}).machineCodes.length > 0, 'typed generated return labels must be disjoint from raw function symbols');

assert.throws(
    () => compileCToObject('int main(void) { goto absent; return 0; }'),
    /(?:undefined|undeclared) label 'absent'/,
    'typed goto must reject an undefined function label',
);
assert.throws(
    () => compileCToObject('int main(void) { repeated: return 0; repeated: return 1; }'),
    /(?:duplicate label|redefinition of label) 'repeated'/,
    'typed functions must reject duplicate labels',
);
assert.throws(
    () => compileCToObject('int main(void) { break; return 0; }'),
    /(?:break used outside loop or switch|'break' statement not in a loop or a switch)/,
    'typed break must be rejected outside a loop or switch',
);
assert.throws(
    () => compileCToObject('int main(void) { continue; return 0; }'),
    /(?:continue used outside loop|'continue' statement not in a loop)/,
    'typed continue must be rejected outside a loop',
);
for (const [statement, pattern] of [
    ['break;', /break used outside loop or switch/],
    ['continue;', /continue used outside loop/],
]) {
    const unit = parseTranslationUnit(tokenizeC(`int main(void) { ${statement} return 0; }`));
    assert.throws(
        () => analyzeTranslationUnit(unit),
        pattern,
        'typed semantic analysis must reject an invalid control-flow jump',
    );
    assert.throws(
        () => lowerProgram(unit),
        pattern,
        'typed lowering must not silently discard an invalid control-flow jump',
    );
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-c-integration-'));
try {
    const header = path.join(root, 'included.h');
    const entry = path.join(root, 'main.c');
    fs.writeFileSync(header, 'int helper(void) { return 7; }\nint included(int left, int right) { int local = left; local = local + right; return local + helper(); }\n');
    fs.writeFileSync(entry, '#include "included.h"\nint main(void) { int result = included(3, 4); result = result + 1; return result; }\n');
    const badHeader = path.join(root, 'bad.h');
    const badEntry = path.join(root, 'bad.c');
    fs.writeFileSync(badHeader, 'float broken(float value) { return value + value; }\n');
    fs.writeFileSync(badEntry, '#include "bad.h"\nint main(void) { return 0; }\n');

    const legacyFile = compileCFile(entry, { moduleName: 'legacy_file_api' });
    assert.strictEqual(typeof legacyFile.assembly, 'string', 'compileCFile must continue returning assembly');

    const preprocessedObject = compileCFileToObject(entry, { moduleName: 'preprocessed_object' });
    const detailedFileObject = compileCFileToObjectDetailed(entry, { moduleName: 'detailed_file_object' });
    assert.strictEqual(detailedFileObject.artifact.target, 'merc32');
    assert.deepStrictEqual(detailedFileObject.diagnostics.filter((item) => item.severity === 'error'), []);
    assert.deepStrictEqual(
        preprocessedObject.symbols.filter((symbol) => symbol.defined && symbol.binding === 'global').map((symbol) => symbol.name),
        ['helper', 'included', 'main', '__merc32_init_globals'],
    );
    assert.ok(preprocessedObject.relocations.some((relocation) => relocation.symbol === 'included'));
    assert.ok(preprocessedObject.relocations.some((relocation) =>
        relocation.symbol === 'helper'
            && relocation.debug?.file === 'included.h'
            && relocation.debug.line === 2,
    ), 'typed relocation debug locations must retain included-source origins');
    assert.throws(
        () => compileCFileToObject(badEntry, { moduleName: 'bad_preprocessed_object' }),
        (error) => error && error.location && error.location.file === 'bad.h'
            && error.location.line === 1,
        'typed diagnostics must preserve included-source locations after preprocessing',
    );

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
        const { buildCFileToRom, compileCFileToAssembly } = require('../out/compilerService');
        const defaultCompile = compileCFileToAssembly(entry);
        assert.match(defaultCompile.assembly, /\.entry __start/,
            'the default service build must retain the legacy bootable startup contract');
        assert.match(defaultCompile.assembly, /mov r13, 0x804\r?\nmov r13, r13 << 16/,
            'the default service build must initialize the configured legacy stack');
        const result = buildCFileToRom(entry, 'normal');
        assert.deepStrictEqual(result.artifacts.map((artifact) => artifact.label), ['main.asm', 'main.v']);
    } finally {
        Module._load = originalLoad;
    }
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

console.log('C public API integration tests passed');
