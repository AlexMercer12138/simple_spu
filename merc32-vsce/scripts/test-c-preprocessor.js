const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { preprocessCFile, CPreprocessorError } = require('../out/cPreprocessor');
const { compileC, compileCFile, CompilerError } = require('../out/cCompiler');
const { SimpleCPUAssembler } = require('../out/assembler');

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

function expectPreprocessorError(run, expected) {
    assert.throws(run, (error) => {
        assert.ok(error instanceof CPreprocessorError);
        if (expected.message) assert.match(error.message, expected.message);
        if (expected.file) assert.strictEqual(error.file, expected.file);
        if (expected.line !== undefined) assert.strictEqual(error.line, expected.line);
        if (expected.column !== undefined) assert.strictEqual(error.column, expected.column);
        return true;
    });
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-cpp-'));
try {
    writeFile(root, 'include/demo_soc.h', [
        '#ifndef DEMO_SOC_H',
        '#define DEMO_SOC_H',
        '#define DEMO_SOC_UART0_BASE 0x10000000',
        '#define DEMO_SOC_UART0_IRQ 0',
        '#endif',
        '',
    ].join('\n'));
    const generatedMain = writeFile(root, 'generated/main.c', [
        '#include "../include/demo_soc.h"',
        'int main(void) {',
        '    volatile unsigned int *uart =',
        '        (volatile unsigned int *)DEMO_SOC_UART0_BASE;',
        '    return DEMO_SOC_UART0_IRQ + (*uart & 0);',
        '}',
        '',
    ].join('\n'));
    const generatedResult = compileCFile(generatedMain, { moduleName: 'demo_main' });
    assert.match(generatedResult.assembly, /mov r7, 0x1000\r?\nmov r7, r7 << 16/);
    assert.ok(new SimpleCPUAssembler().assemble(generatedResult.assembly, {
        sourceFileName: 'demo_main.asm',
    }).machineCodes.length > 0);

    const brokenHeader = writeFile(root, 'include/broken.h', 'int broken = @;\n');
    const brokenMain = writeFile(root, 'broken-main.c', '#include "include/broken.h"\nint main(void) { return 0; }\n');
    assert.throws(
        () => compileCFile(brokenMain),
        (error) => {
            assert.ok(error instanceof CompilerError);
            assert.strictEqual(error.sourceFile, brokenHeader);
            assert.strictEqual(error.line, 1);
            assert.strictEqual(error.column, 14);
            assert.strictEqual(error.message, `${brokenHeader}:1:14: unexpected character '@'`);
            return true;
        },
    );

    function expectIncludedCompilerError(relativePath, source, expected) {
        const header = writeFile(root, relativePath, source);
        const main = writeFile(
            root,
            `${path.basename(relativePath)}.main.c`,
            `#include "${relativePath}"\nint main(void) { return 0; }\n`,
        );
        assert.throws(
            () => compileCFile(main),
            (error) => {
                assert.ok(error instanceof CompilerError);
                assert.strictEqual(error.sourceFile, header);
                assert.strictEqual(error.line, expected.line);
                assert.strictEqual(error.column, expected.column);
                assert.strictEqual(
                    error.message,
                    `${header}:${expected.line}:${expected.column}: ${expected.detail}`,
                );
                return true;
            },
        );
    }

    expectIncludedCompilerError(
        'include/parser-error.h',
        'int parser_error(void) { return 1 }\n',
        { line: 1, column: 35, detail: "expected ';'" },
    );
    expectIncludedCompilerError(
        'include/unknown-variable.h',
        'int unknown_variable(void) { return missing_name; }\n',
        { line: 1, column: 37, detail: "unknown variable 'missing_name'" },
    );
    expectIncludedCompilerError(
        'include/type-error.h',
        'int type_error(void) { return "text" * 2; }\n',
        { line: 1, column: 38, detail: "operator '*' does not accept pointer operands" },
    );
    expectIncludedCompilerError(
        'include/call-error.h',
        'int call_error(void) { return missing_call(); }\n',
        { line: 1, column: 31, detail: "unknown function 'missing_call'" },
    );

    assert.strictEqual(new CompilerError('legacy location', 7, 9).message, '7:9: legacy location');
    assert.strictEqual(new CompilerError('legacy no location').message, 'legacy no location');

    for (const [source, message] of [
        ['int main(void) { return missing_name; }', "unknown variable 'missing_name'"],
        ['int main(void) { return "text" * 2; }', "operator '*' does not accept pointer operands"],
        ['int main(void) { return missing_call(); }', "unknown function 'missing_call'"],
    ]) {
        assert.throws(
            () => compileC(source),
            (error) => error instanceof CompilerError && error.message === message,
        );
    }

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

    const commentedHeader = writeFile(root, 'include/commented.h', [
        '#ifndef COMMENTED_H /* conventional guard comment */',
        '#define COMMENTED_H // guard definition',
        '#define COMMENTED_VALUE 7 // trailing line comment',
        '#define COMMENTED_SUM 1 /* inline block comment */ + 2',
        '#if 1 /* true */',
        '#define COMMENTED_SELECTED COMMENTED_VALUE /* trailing block comment */',
        '#endif /* true */',
        '#define COMMENTED_CROSS_LINE 9 /* directive comment begins',
        'this text @ is inside the directive comment and must not reach Tiny C',
        '*/ int after_directive_comment = COMMENTED_VALUE;',
        '#endif /* COMMENTED_H */',
        '',
    ].join('\n'));
    const commentedMain = writeFile(root, 'commented-main.c', [
        '#include "include/commented.h" // include comment',
        'int main(void) {',
        '    return COMMENTED_SELECTED + COMMENTED_SUM + COMMENTED_CROSS_LINE',
        '        + after_directive_comment;',
        '}',
        '',
    ].join('\n'));
    const commentedPreprocessed = preprocessCFile(commentedMain);
    assert.match(commentedPreprocessed.code, /return\s+7\s+\+\s+1\s+\+\s+2\s+\+\s+9\s+\+\s+after_directive_comment\s*;/);
    assert.match(commentedPreprocessed.code, /int after_directive_comment = 7\s*;/);
    assert.doesNotMatch(commentedPreprocessed.code, /this text @/);
    assert.ok(compileCFile(commentedMain, { moduleName: 'commented_header_test' }).assembly.length > 0);
    assert.ok(commentedPreprocessed.lineMap.some((location) => location.file === commentedHeader));

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

    const definedPlaceholderCollision = preprocess([
        '#define __MERC32_DEFINED_OPERAND_0__ 0',
        '#define NAME 1',
        '#if defined(NAME)',
        'int parenthesized_defined_collision_safe = 1;',
        '#endif',
        '#if defined NAME',
        'int bare_defined_collision_safe = 1;',
        '#endif',
    ].join('\n'), {});
    assert.match(definedPlaceholderCollision, /parenthesized_defined_collision_safe/);
    assert.match(definedPlaceholderCollision, /bare_defined_collision_safe/);

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

    for (const invalidDepth of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        1.5,
        0,
        -1,
        33,
    ]) {
        expectPreprocessorError(
            () => preprocessCFile(path.join(root, 'main.c'), { maxIncludeDepth: invalidDepth }),
            { message: /maxIncludeDepth must be a finite safe integer in range 1\.\.32/ },
        );
    }
    assert.match(
        preprocessCFile(path.join(root, 'depth-32-0.h'), { maxIncludeDepth: 32 }).code,
        /int deepest_include;/,
    );

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

    const indentedUnsupported = writeFile(root, 'indented-unsupported.c', '    #elif 1\n');
    expectPreprocessorError(
        () => preprocessCFile(indentedUnsupported),
        { file: indentedUnsupported, line: 1, column: 5, message: /unsupported preprocessor directive '#elif'/ },
    );

    const recursiveMacroLine = 'int recursive =       FIRST;';
    const recursiveMacro = writeFile(root, 'recursive-macro.c', [
        '#define FIRST ( SECOND )',
        '#define SECOND FIRST',
        recursiveMacroLine,
        '',
    ].join('\n'));
    expectPreprocessorError(
        () => preprocessCFile(recursiveMacro),
        {
            file: recursiveMacro,
            line: 3,
            column: recursiveMacroLine.indexOf('FIRST') + 1,
            message: /recursive macro expansion for 'FIRST'/,
        },
    );

    const malformedIfLine = '   #if 1 + @';
    const malformedIf = writeFile(root, 'malformed-if.c', `${malformedIfLine}\n#endif\n`);
    expectPreprocessorError(
        () => preprocessCFile(malformedIf),
        {
            file: malformedIf,
            line: 1,
            column: malformedIfLine.indexOf('@') + 1,
            message: /invalid token '@' in #if expression/,
        },
    );

    const unsupportedIncludeLine = '  #include <system.h>';
    const unsupportedInclude = writeFile(root, 'unsupported-include.c', `${unsupportedIncludeLine}\n`);
    expectPreprocessorError(
        () => preprocessCFile(unsupportedInclude),
        {
            file: unsupportedInclude,
            line: 1,
            column: unsupportedIncludeLine.indexOf('<') + 1,
            message: /only quoted includes are supported/,
        },
    );

    const eofContinuationLine = '    #define VALUE \\';
    const eofContinuation = writeFile(root, 'eof-continuation.c', eofContinuationLine);
    expectPreprocessorError(
        () => preprocessCFile(eofContinuation),
        {
            file: eofContinuation,
            line: 1,
            column: eofContinuationLine.length,
            message: /unterminated directive continuation/,
        },
    );
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

console.log('Tiny C preprocessor tests passed.');
