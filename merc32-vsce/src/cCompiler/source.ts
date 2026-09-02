export interface SourceLocation { readonly file: string; readonly line: number; readonly column: number; }
export function sourceLocation(file: string, line: number, column: number): SourceLocation { return Object.freeze({ file, line, column }); }
export function sameSourceLocation(left: SourceLocation, right: SourceLocation): boolean { return left.file === right.file && left.line === right.line && left.column === right.column; }

export class CFrontendError extends Error {
    readonly detail: string;
    readonly location: SourceLocation;

    constructor(message: string, location: SourceLocation) {
        super(location.file
            ? `${location.file}:${location.line}:${location.column}: ${message}`
            : `${location.line}:${location.column}: ${message}`);
        this.detail = message;
        this.location = location;
        this.name = 'CFrontendError';
    }
}
