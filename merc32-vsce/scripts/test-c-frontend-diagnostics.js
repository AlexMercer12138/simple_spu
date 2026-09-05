const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    compileCFileDetailed,
    withCCompileDiagnosticSources,
} = require('../out/cCompiler');
const { CDiagnostics } = require('../out/cDiagnostics');

function makeVscodeDouble() {
    const entries = new Map();
    let cleared = 0;
    let disposed = 0;
    class Position {
        constructor(line, character) { this.line = line; this.character = character; }
    }
    class Range {
        constructor(start, end) { this.start = start; this.end = end; }
    }
    class Location {
        constructor(uri, range) { this.uri = uri; this.range = range; }
    }
    class DiagnosticRelatedInformation {
        constructor(location, message) { this.location = location; this.message = message; }
    }
    class Diagnostic {
        constructor(range, message, severity) {
            this.range = range;
            this.message = message;
            this.severity = severity;
            this.relatedInformation = [];
        }
    }
    return {
        api: {
            Uri: {
                file: (file) => ({ fsPath: path.resolve(file), toString: () => path.resolve(file) }),
            },
            Position,
            Range,
            Location,
            Diagnostic,
            DiagnosticRelatedInformation,
            DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
            languages: {
                createDiagnosticCollection: (name) => {
                    assert.strictEqual(name, 'merc32-c');
                    return {
                        set: (uri, diagnostics) => entries.set(uri.fsPath, diagnostics),
                        delete: (uri) => entries.delete(uri.fsPath),
                        clear: () => { cleared += 1; entries.clear(); },
                        dispose: () => { disposed += 1; },
                    };
                },
            },
        },
        entries,
        counts: () => ({ cleared, disposed }),
    };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-c-diagnostics-'));
try {
    const header = path.join(root, 'trace.h');
    const main = path.join(root, 'main.c');
    fs.writeFileSync(header, 'const char *text = "中";\n', 'utf8');
    fs.writeFileSync(main, '#include "trace.h"\nint main(void) { return 0; }\n', 'utf8');

    assert.strictEqual(typeof CDiagnostics, 'function', 'CDiagnostics must be exported');
    assert.strictEqual(typeof withCCompileDiagnosticSources, 'function',
        'mapped detailed results must retain source snapshots for Problems');

    const fake = makeVscodeDouble();
    const diagnostics = new CDiagnostics(fake.api);
    const fileIds = { main: 1, header: 2 };
    const sourceFiles = [
        { id: fileIds.main, path: 'main.c', byteLength: Buffer.byteLength(fs.readFileSync(main, 'utf8')), utf8BoundaryBitmap: 'ffff' },
        { id: fileIds.header, path: 'trace.h', byteLength: Buffer.byteLength(fs.readFileSync(header, 'utf8')), utf8BoundaryBitmap: 'ffff' },
    ];
    const position = (line, column, byteOffset) => ({ line, column, byteOffset });
    const range = (file, startByte, endByte) => ({
        file,
        start: position(1, startByte + 1, startByte),
        end: position(1, endByte + 1, endByte),
    });
    const result = withCCompileDiagnosticSources({
        diagnostics: [
            {
                severity: 'warning',
                code: 'W_UTF8',
                message: 'warning after unicode',
                range: range(fileIds.header, 23, 24),
                related: [{ message: 'declared here', range: range(fileIds.main, 0, 8) }],
                notes: ['first note'],
                includeTrace: [range(fileIds.main, 0, 18)],
                macroExpansionTrace: [range(fileIds.header, 20, 23)],
            },
            {
                severity: 'error',
                code: 'E_SECOND',
                message: 'second error',
                range: range(fileIds.main, 19, 22),
                related: [], notes: [], includeTrace: [], macroExpansionTrace: [],
            },
        ],
    }, sourceFiles, [
        { file: sourceFiles[0], canonicalPath: main, source: fs.readFileSync(main, 'utf8') },
        { file: sourceFiles[1], canonicalPath: header, source: fs.readFileSync(header, 'utf8') },
    ]);

    diagnostics.update(result);
    assert.deepStrictEqual([...fake.entries.keys()].sort(), [header, main].map((file) => path.resolve(file)).sort(),
        'primary diagnostics must be grouped by canonical URI');
    const warning = fake.entries.get(path.resolve(header))[0];
    assert.strictEqual(warning.source, 'MERC32 C');
    assert.strictEqual(warning.code, 'W_UTF8');
    assert.strictEqual(warning.severity, fake.api.DiagnosticSeverity.Warning);
    assert.match(warning.message, /first note/);
    assert.strictEqual(warning.range.start.character, 21,
        'UTF-8 byte offsets must become zero-based UTF-16 columns');
    assert.deepStrictEqual(warning.relatedInformation.map((item) => item.message), [
        'declared here', 'Included from here', 'Expanded from macro here',
    ]);
    assert.strictEqual(warning.relatedInformation[0].location.uri.fsPath, path.resolve(main));

    fs.writeFileSync(main, 'int main(void) { return 0; }\n', 'utf8');
    const successful = compileCFileDetailed(main, { moduleName: 'diagnostics_clear' });
    assert.ok(successful.artifact, 'success fixture must compile');
    diagnostics.update(successful);
    assert.strictEqual(fake.entries.has(path.resolve(main)), false,
        'a successful compile must clear stale diagnostics for the affected file');
    assert.strictEqual(fake.entries.has(path.resolve(header)), false,
        'a successful compile must clear stale included-file diagnostics');

    const bomMain = path.join(root, 'bom.c');
    fs.writeFileSync(bomMain, '\ufeffint main(void) { return missing_name; }\n', 'utf8');
    const bomResult = compileCFileDetailed(bomMain);
    assert.strictEqual(bomResult.artifact, undefined, 'BOM fixture must fail compilation');
    diagnostics.update(bomResult);
    const bomDiagnostic = fake.entries.get(path.resolve(bomMain))[0];
    assert.strictEqual(bomDiagnostic.range.start.character, 24,
        'file snapshots must use the same BOM-stripping UTF-8 decoder as the Aro source provider');

    diagnostics.dispose();
    assert.deepStrictEqual(fake.counts(), { cleared: 1, disposed: 1 });
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

console.log('C frontend diagnostics tests passed.');
