import type { CFrontendDiagnostic, SourceFileRecord } from '../cFrontend/contract';

export interface SourceLocation { readonly file: string; readonly line: number; readonly column: number; }
export function sourceLocation(file: string, line: number, column: number): SourceLocation { return Object.freeze({ file, line, column }); }
export function sameSourceLocation(left: SourceLocation, right: SourceLocation): boolean { return left.file === right.file && left.line === right.line && left.column === right.column; }

export class CFrontendError extends Error {
    readonly detail: string;
    readonly location: SourceLocation;
    readonly diagnostics: readonly CFrontendDiagnostic[];

    constructor(message: string, location: SourceLocation);
    constructor(diagnostics: readonly CFrontendDiagnostic[], sourceFiles?: readonly SourceFileRecord[]);
    constructor(messageOrDiagnostics: string | readonly CFrontendDiagnostic[],
        locationOrSourceFiles: SourceLocation | readonly SourceFileRecord[] = [] as const) {
        const diagnostics = typeof messageOrDiagnostics === 'string' ? [] : messageOrDiagnostics;
        const files = new Map<number, string>();
        if (Array.isArray(locationOrSourceFiles)) {
            for (const file of locationOrSourceFiles as readonly SourceFileRecord[]) {
                files.set(Number(file.id), file.path);
            }
        }
        const first = diagnostics[0];
        const location: SourceLocation = typeof messageOrDiagnostics === 'string'
            ? locationOrSourceFiles as SourceLocation
            : first === undefined
                ? { file: '', line: 1, column: 1 }
                : {
                    file: files.get(Number(first.range.file)) ?? String(first.range.file),
                    line: first.range.start.line,
                    column: first.range.start.column,
                };
        const detail = typeof messageOrDiagnostics === 'string'
            ? messageOrDiagnostics
            : diagnostics.map((diagnostic) => diagnostic.message).join('\n') || 'C frontend failed';
        super(location.file
            ? `${location.file}:${location.line}:${location.column}: ${detail}`
            : `${location.line}:${location.column}: ${detail}`);
        this.detail = detail;
        this.location = Object.freeze({ ...location });
        this.diagnostics = Object.freeze([...diagnostics]);
        this.name = 'CFrontendError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
