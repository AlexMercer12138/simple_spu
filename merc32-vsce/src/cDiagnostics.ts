import * as fs from 'fs';
import * as path from 'path';
import type * as vscode from 'vscode';

import {
    CCompileDiagnosticSource,
    getCCompileDiagnosticSources,
} from './cCompiler';
import type {
    CCompileDetailedResult,
    CFrontendDiagnostic,
    SourceRange,
} from './cFrontend/contract';

type VscodeApi = typeof import('vscode');

export class CDiagnostics implements vscode.Disposable {
    private readonly collection: vscode.DiagnosticCollection;
    private readonly affectedFiles = new Map<string, ReadonlySet<string>>();

    public constructor(private readonly vscodeApi: VscodeApi = loadVscode()) {
        this.collection = vscodeApi.languages.createDiagnosticCollection('merc32-c');
    }

    public update<T>(result: CCompileDetailedResult<T>): void {
        const sources = sourceTable(result, this.vscodeApi);
        const primary = sources.values().next().value as CCompileDiagnosticSource | undefined;
        const rootKey = primary === undefined ? undefined : pathKey(primary.canonicalPath);
        if (rootKey !== undefined) {
            for (const file of this.affectedFiles.get(rootKey) ?? []) {
                this.collection.delete(this.vscodeApi.Uri.file(file));
            }
        }
        const grouped = new Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }>();
        for (const source of sources.values()) {
            const uri = this.vscodeApi.Uri.file(source.canonicalPath);
            this.collection.delete(uri);
        }
        for (const diagnostic of result.diagnostics) {
            const source = sources.get(Number(diagnostic.range.file));
            if (!source) continue;
            const uri = this.vscodeApi.Uri.file(source.canonicalPath);
            const key = uri.toString();
            const group = grouped.get(key) ?? { uri, diagnostics: [] };
            group.diagnostics.push(this.toVscodeDiagnostic(diagnostic, source, sources));
            grouped.set(key, group);
        }
        for (const group of grouped.values()) this.collection.set(group.uri, group.diagnostics);
        if (rootKey !== undefined) {
            this.affectedFiles.set(rootKey,
                new Set([...sources.values()].map((source) => source.canonicalPath)));
        }
    }

    public clear(sourceFile: string): void {
        const canonical = canonicalPath(sourceFile);
        const rootKey = pathKey(canonical);
        for (const file of this.affectedFiles.get(rootKey) ?? [canonical]) {
            this.collection.delete(this.vscodeApi.Uri.file(file));
        }
        this.affectedFiles.delete(rootKey);
    }

    public dispose(): void {
        this.affectedFiles.clear();
        this.collection.clear();
        this.collection.dispose();
    }

    private toVscodeDiagnostic(diagnostic: CFrontendDiagnostic,
        source: CCompileDiagnosticSource,
        sources: ReadonlyMap<number, CCompileDiagnosticSource>): vscode.Diagnostic {
        const severity = diagnostic.severity === 'warning'
            ? this.vscodeApi.DiagnosticSeverity.Warning
            : diagnostic.severity === 'note'
                ? this.vscodeApi.DiagnosticSeverity.Information
                : this.vscodeApi.DiagnosticSeverity.Error;
        const message = diagnostic.notes.length === 0
            ? diagnostic.message
            : `${diagnostic.message}\n${diagnostic.notes.join('\n')}`;
        const item = new this.vscodeApi.Diagnostic(this.range(diagnostic.range, source), message, severity);
        item.source = 'MERC32 C';
        item.code = diagnostic.code;
        item.relatedInformation = [
            ...diagnostic.related.map((related) => this.related(related.range, related.message, sources)),
            ...diagnostic.includeTrace.map((range) => this.related(range, 'Included from here', sources)),
            ...diagnostic.macroExpansionTrace.map((range) =>
                this.related(range, 'Expanded from macro here', sources)),
        ].filter((related): related is vscode.DiagnosticRelatedInformation => related !== undefined);
        return item;
    }

    private related(range: SourceRange, message: string,
        sources: ReadonlyMap<number, CCompileDiagnosticSource>): vscode.DiagnosticRelatedInformation | undefined {
        const source = sources.get(Number(range.file));
        if (!source) return undefined;
        return new this.vscodeApi.DiagnosticRelatedInformation(
            new this.vscodeApi.Location(
                this.vscodeApi.Uri.file(source.canonicalPath),
                this.range(range, source),
            ),
            message,
        );
    }

    private range(range: SourceRange, source: CCompileDiagnosticSource): vscode.Range {
        return new this.vscodeApi.Range(
            byteOffsetPosition(source.source, range.start.byteOffset, this.vscodeApi),
            byteOffsetPosition(source.source, range.end.byteOffset, this.vscodeApi),
        );
    }
}

function sourceTable<T>(result: CCompileDetailedResult<T>,
    vscodeApi: VscodeApi): ReadonlyMap<number, CCompileDiagnosticSource> {
    const sources = new Map<number, CCompileDiagnosticSource>();
    for (const source of getCCompileDiagnosticSources(result)) {
        const canonical = canonicalPath(source.canonicalPath);
        const uri = vscodeApi.Uri.file(canonical);
        sources.set(Number(source.file.id), Object.freeze({
            file: source.file,
            canonicalPath: uri.fsPath,
            source: source.source,
        }));
    }
    return sources;
}

function byteOffsetPosition(source: string, byteOffset: number,
    vscodeApi: VscodeApi): vscode.Position {
    const bytes = Buffer.from(source, 'utf8');
    const bounded = Math.max(0, Math.min(bytes.length, byteOffset));
    const prefix = bytes.subarray(0, bounded).toString('utf8');
    const line = (prefix.match(/\n/gu) ?? []).length;
    const lastNewline = prefix.lastIndexOf('\n');
    const character = prefix.length - (lastNewline + 1);
    return new vscodeApi.Position(line, character);
}

function canonicalPath(file: string): string {
    try {
        return fs.realpathSync.native(file);
    } catch {
        return path.resolve(file);
    }
}

function pathKey(file: string): string {
    const resolved = path.resolve(file);
    return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function loadVscode(): VscodeApi {
    return require('vscode') as VscodeApi;
}
