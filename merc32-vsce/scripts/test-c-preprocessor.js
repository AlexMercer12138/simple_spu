const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { preprocessCFile, CPreprocessorError } = require('../out/cPreprocessor');

function writeFile(root, relativePath, contents) {
    const file = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
    return file;
}

function preprocess(source, macros) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-cpp-'));
    try {
        const definitions = Object.entries(macros)
            .map(([name, replacement]) => `#define ${name} ${replacement}`)
            .join('\n');
        const entry = writeFile(root, 'main.c', `${definitions}\n${source}\n`);
        return preprocessCFile(entry).code;
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function preprocessFile(root, relativePath) {
    return preprocessCFile(path.join(root, relativePath));
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-cpp-'));
try {
    writeFile(root, 'soc.h', [
        '#ifndef DEMO_SOC_H',
        '#define DEMO_SOC_H',
        '#define UART0_BASE 0x10000000',
        '#define UART0_IRQ 3',
        '#endif',
        '',
    ].join('\n'));
    writeFile(root, 'main.c', [
        '#include "soc.h"',
        '#include "soc.h"',
        'char *text = "UART0_BASE";',
        'int main(void) { return UART0_IRQ; }',
        '',
    ].join('\n'));

    const result = preprocessFile(root, 'main.c');
    assert.match(result.code, /return 3;/);
    assert.match(result.code, /"UART0_BASE"/);
    assert.ok(result.lineMap.some((line) => line.file.endsWith('soc.h')));

    const conditional = preprocess([
        '#define ENABLED 1',
        '#define IRQ_COUNT 3',
        '#if ENABLED && (IRQ_COUNT == 3)',
        'int selected = 1;',
        '#else',
        'int selected = 0;',
        '#endif',
    ].join('\n'), {});
    assert.match(conditional, /int selected = 1;/);
    assert.doesNotMatch(conditional, /int selected = 0;/);

    const expressionOperators = preprocess([
        '#define OUTER INNER',
        '#define INNER 3',
        '#if !0 && (~0 == -1) && (+5 == 5) && (-5 < 0) && (7 * 3 / 2 % 5 == 0) && ((1 << 4) == 16) && ((16 >> 2) == 4) && (3 < 4) && (4 <= 4) && (4 > 3) && (4 >= 4) && (5 != 4) && (5 == 5) && ((6 & 3) == 2) && ((4 ^ 1) == 5) && ((4 | 1) == 5) && ((0x7fffffff + 1) < 0) && (0x20000000000001 == 1) && (OUTER == 3) || 0',
        'int operators_work = 1;',
        '#endif',
    ].join('\n'), {});
    assert.match(expressionOperators, /int operators_work = 1;/);

    const definedAndUnknown = preprocess([
        '#define NAME 0',
        '#if defined(NAME) && defined NAME && UNKNOWN_IDENTIFIER',
        'int wrong = 1;',
        '#else',
        'int unknown_is_zero = 1;',
        '#endif',
        '#if defined(NAME)',
        'int defined_operand_is_not_expanded = 1;',
        '#endif',
    ].join('\n'), {});
    assert.match(definedAndUnknown, /int unknown_is_zero = 1;/);
    assert.match(definedAndUnknown, /int defined_operand_is_not_expanded = 1;/);
    assert.doesNotMatch(definedAndUnknown, /int wrong = 1;/);

    writeFile(root, 'inactive-branch.c', [
        '#if 0',
        '#include "missing-while-inactive.h"',
        '#define HIDDEN 1',
        '#if 1',
        'int nested_wrong = 1;',
        '#else',
        'int nested_wrong = 2;',
        '#endif',
        '#else',
        '#ifndef HIDDEN',
        'int active_after_inactive = 1;',
        '#endif',
        '#endif',
        '',
    ].join('\n'));
    const inactiveBranch = preprocessFile(root, 'inactive-branch.c').code;
    assert.match(inactiveBranch, /int active_after_inactive = 1;/);
    assert.doesNotMatch(inactiveBranch, /nested_wrong/);

    writeFile(root, 'inactive-comment-directives.c', [
        '#if 0',
        '/*',
        '#else',
        '#endif',
        '*/',
        '#else',
        'int selected_after_inactive_comment = 1;',
        '#endif',
        '',
    ].join('\n'));
    assert.match(
        preprocessFile(root, 'inactive-comment-directives.c').code,
        /int selected_after_inactive_comment = 1;/,
    );

    assert.match(preprocess('#define PRESENT 1\n#ifdef PRESENT\nint ifdef_selected = 1;\n#endif', {}), /ifdef_selected/);
    assert.match(preprocess('#ifndef ABSENT\nint ifndef_selected = 1;\n#endif', {}), /ifndef_selected/);
    assert.throws(() => preprocess('#else\n', {}), /unexpected #else/);
    assert.throws(() => preprocess('#if 1\n#else\n#else\n#endif\n', {}), /duplicate #else/);
    assert.throws(() => preprocess('#if 1\nint missing_endif;\n', {}), /unterminated conditional/);
    assert.throws(() => preprocess('#if 1 / 0\n#endif\n', {}), /division by zero/);
    assert.throws(() => preprocess('#if 1 % 0\n#endif\n', {}), /remainder by zero/);
    assert.match(
        preprocess('#if 0 && (1 / 0)\nint short_circuited = 0;\n#else\nint short_circuited = 1;\n#endif\n', {}),
        /int short_circuited = 1;/,
    );

    writeFile(root, 'cycle-a.h', '#include "cycle-b.h"\n');
    writeFile(root, 'cycle-b.h', '#include "cycle-a.h"\n');
    writeFile(root, 'cycle-main.c', '#include "cycle-a.h"\n');
    assert.throws(() => preprocessFile(root, 'cycle-main.c'), /include cycle/);

    for (let index = 0; index < 32; index++) {
        writeFile(root, `depth-32-${index}.h`, index === 31 ? 'int deepest_include;\n' : `#include "depth-32-${index + 1}.h"\n`);
    }
    assert.match(preprocessFile(root, 'depth-32-0.h').code, /int deepest_include;/);

    for (let index = 0; index < 33; index++) {
        writeFile(root, `depth-33-${index}.h`, index === 32 ? 'int too_deep_include;\n' : `#include "depth-33-${index + 1}.h"\n`);
    }
    assert.throws(() => preprocessFile(root, 'depth-33-0.h'), /include depth exceeds 32/);

    assert.match(preprocess('int x = VALUE;', { VALUE: '7' }), /int x = 7;/);
    assert.match(preprocess('char *s = "VALUE";', { VALUE: '7' }), /"VALUE"/);
    assert.match(preprocess("int c = 'V';", { V: '7' }), /'V'/);
    assert.match(preprocess('/* VALUE */ int x;', { VALUE: '7' }), /\/\* VALUE \*\//);
    assert.match(
        preprocess('#define VALUE 7\n#undef VALUE\nint x = VALUE;', {}),
        /int x = VALUE;/,
    );

    writeFile(root, 'comment-directive.c', [
        '#define COMMENT /* begins a block comment',
        '#include "missing.h"',
        '*/',
        '#define OK 9',
        'int value = OK;',
        '',
    ].join('\n'));
    assert.match(preprocessFile(root, 'comment-directive.c').code, /int value = 9;/);

    writeFile(root, 'continued-directive.c', [
        '#define VALUE 1 + \\',
        '2',
        'int x = VALUE;',
        '',
    ].join('\n'));
    const continuedDirective = preprocessFile(root, 'continued-directive.c');
    assert.match(continuedDirective.code, /int x = 1 \+ 2;/);
    assert.deepStrictEqual(
        continuedDirective.lineMap.map((location) => location.line),
        [1, 2, 3, 4],
    );

    writeFile(root, 'continued-header.h', '#define FROM_CONTINUED_INCLUDE 12\n');
    writeFile(root, 'continued-include.c', [
        '#include "continued-\\',
        'header.h"',
        'int included = FROM_CONTINUED_INCLUDE;',
        '',
    ].join('\n'));
    const continuedInclude = preprocessFile(root, 'continued-include.c');
    assert.match(continuedInclude.code, /int included = 12;/);
    assert.deepStrictEqual(
        continuedInclude.lineMap.slice(0, 2).map((location) => location.line),
        [1, 2],
    );

    const injectedEntry = path.resolve(root, 'injected-main.c');
    const injectedHeader = path.resolve(root, 'injected.h');
    const injectedFiles = new Map([
        [injectedEntry, '#include "injected.h"\nint injected = NUMBER;\n'],
        [injectedHeader, '#define NUMBER 5\n'],
    ]);
    assert.match(
        preprocessCFile(injectedEntry, {
            realPath: (file) => file,
            readFile: (file) => {
                const contents = injectedFiles.get(file);
                if (contents === undefined) throw new Error('not found');
                return contents;
            },
        }).code,
        /int injected = 5;/,
    );

    writeFile(root, 'inc/a.h', '#include "nested/b.h"\n#define RESULT NESTED_VALUE\n');
    writeFile(root, 'inc/nested/b.h', '#define NESTED_VALUE 11\n');
    writeFile(root, 'nested-main.c', '#include "inc/a.h"\nint x = RESULT;\n');
    assert.match(preprocessFile(root, 'nested-main.c').code, /int x = 11;/);

    assert.throws(() => preprocessFile(root, 'missing.c'), /cannot read include/);
    writeFile(root, 'function_macro.c', '#define F(x) x\n');
    assert.throws(() => preprocessFile(root, 'function_macro.c'), /function-style macros are not supported/);
    assert.throws(
        () => preprocessCFile(path.join(root, 'missing.c')),
        (error) => error instanceof CPreprocessorError && /cannot read include/.test(error.message),
    );
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

console.log('Tiny C preprocessor tests passed.');
