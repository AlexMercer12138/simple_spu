import type * as vscode from 'vscode';

import { SOC_CONFIG_SUFFIX } from './constants';
import {
    loadCatalog,
    ModuleCatalog,
    parseSocConfig,
    planSoc,
    SocDiagnostic,
    SocJsonRange,
    SocSourceMap,
} from './soc';

type VscodeApi = typeof import('vscode');

/** Resolves a diagnostic path to its closest existing JSON source range. */
export function diagnosticRange(
    documentText: string,
    sourceMap: SocSourceMap,
    diagnostic: SocDiagnostic,
): SocJsonRange {
    for (let length = diagnostic.path.length; length >= 0; length -= 1) {
        const range = sourceMap.rangeFor(diagnostic.path.slice(0, length));
        if (range) {
            return range;
        }
    }
    return { offset: 0, length: documentText.length };
}

/** Publishes parser-backed diagnostics for compound MERC32 SoC JSON documents. */
export class SocDiagnostics implements vscode.Disposable {
    private readonly vscodeApi: VscodeApi;
    private readonly catalog: ModuleCatalog;
    private readonly collection: vscode.DiagnosticCollection;
    private readonly subscriptions: vscode.Disposable[];
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(
        catalogOrAssetRoot: ModuleCatalog | string,
        vscodeApi: VscodeApi = loadVscode() as VscodeApi,
    ) {
        this.vscodeApi = vscodeApi;
        this.catalog = typeof catalogOrAssetRoot === 'string'
            ? loadCatalog(catalogOrAssetRoot)
            : catalogOrAssetRoot;
        this.collection = vscodeApi.languages.createDiagnosticCollection('merc32-soc');
        this.subscriptions = [
            vscodeApi.workspace.onDidOpenTextDocument((document) => this.refresh(document)),
            vscodeApi.workspace.onDidChangeTextDocument((event) => this.schedule(event.document)),
            vscodeApi.workspace.onDidCloseTextDocument((document) => this.clear(document)),
        ];

        for (const document of vscodeApi.workspace.textDocuments) {
            if (isSocDocument(document)) {
                this.refresh(document);
            }
        }
    }

    refresh(
        document: vscode.TextDocument,
        additionalDiagnostics: readonly SocDiagnostic[] = [],
    ): readonly SocDiagnostic[] {
        if (!isSocDocument(document)) {
            return [];
        }
        this.cancelScheduled(document.uri.toString());

        const text = document.getText();
        const parsed = parseSocConfig(text, document.fileName, this.catalog);
        const planned = parsed.config ? planSoc(parsed.config, this.catalog) : undefined;
        const diagnostics = deduplicateDiagnostics([
            ...parsed.diagnostics,
            ...(planned?.diagnostics ?? []),
            ...additionalDiagnostics,
        ]);
        const published = diagnostics.map((diagnostic) => {
            const range = diagnosticRange(text, parsed.sourceMap, diagnostic);
            const severity = diagnostic.severity === 'error'
                ? this.vscodeApi.DiagnosticSeverity.Error
                : this.vscodeApi.DiagnosticSeverity.Warning;
            const item = new this.vscodeApi.Diagnostic(
                new this.vscodeApi.Range(
                    document.positionAt(range.offset),
                    document.positionAt(range.offset + range.length),
                ),
                diagnostic.message,
                severity,
            );
            item.source = 'MERC32 SoC';
            item.code = diagnostic.code;
            return item;
        });
        this.collection.set(document.uri, published);
        return diagnostics;
    }

    clear(document: vscode.TextDocument): void {
        this.cancelScheduled(document.uri.toString());
        this.collection.delete(document.uri);
    }

    dispose(): void {
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
        for (const subscription of this.subscriptions) {
            subscription.dispose();
        }
        this.collection.clear();
        this.collection.dispose();
    }

    private schedule(document: vscode.TextDocument): void {
        if (!isSocDocument(document)) {
            return;
        }
        const key = document.uri.toString();
        const previous = this.timers.get(key);
        if (previous) {
            clearTimeout(previous);
        }
        const timer = setTimeout(() => {
            if (this.timers.get(key) !== timer) return;
            this.timers.delete(key);
            this.refresh(document);
        }, 150);
        this.timers.set(key, timer);
    }

    private cancelScheduled(key: string): void {
        const timer = this.timers.get(key);
        if (!timer) return;
        clearTimeout(timer);
        this.timers.delete(key);
    }
}

function deduplicateDiagnostics(diagnostics: readonly SocDiagnostic[]): SocDiagnostic[] {
    const seen = new Set<string>();
    return diagnostics.filter((diagnostic) => {
        const key = `${diagnostic.severity}\0${diagnostic.code}\0${JSON.stringify(diagnostic.path)}`
            + `\0${diagnostic.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function isSocDocument(document: vscode.TextDocument): boolean {
    return document.fileName.endsWith(SOC_CONFIG_SUFFIX);
}

function loadVscode(): unknown {
    return require('vscode');
}
