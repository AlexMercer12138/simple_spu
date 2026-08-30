import type { Buffer } from 'buffer';

export const OUTPUT_FORMATS = ['verilog', 'coe', 'mif', 'hex', 'bin', 'mem'] as const;
export type OutputFormat = typeof OUTPUT_FORMATS[number];
export const DEFAULT_OUTPUT_FORMAT: OutputFormat = 'verilog';

export const COMPILE_MODES = ['normal', 'print', 'debug'] as const;
export type CompileMode = typeof COMPILE_MODES[number];
export const DEFAULT_COMPILE_MODE: CompileMode = 'normal';

export interface AssemblyDebugInfo {
    debugCode: string;
    debugSymbols: string;
    replacedCode: string;
    entryLabel?: string;
}

export interface FileAssemblyResult {
    output: string | Buffer;
    outputFile?: string;
    debugInfo?: AssemblyDebugInfo;
}

export interface ToolchainArtifact {
    label: string;
    file: string;
    description?: string;
}

export interface CompilerArtifactStore {
    setCompilerArtifacts(artifacts: readonly ToolchainArtifact[]): void;
    getCompilerArtifacts(): readonly ToolchainArtifact[];
}

export function isOutputFormat(value: string | undefined): value is OutputFormat {
    return Boolean(value && (OUTPUT_FORMATS as readonly string[]).includes(value));
}
