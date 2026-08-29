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
