export interface SourceLocation { readonly file: string; readonly line: number; readonly column: number; }
export function sourceLocation(file: string, line: number, column: number): SourceLocation { return Object.freeze({ file, line, column }); }
export function sameSourceLocation(left: SourceLocation, right: SourceLocation): boolean { return left.file === right.file && left.line === right.line && left.column === right.column; }
