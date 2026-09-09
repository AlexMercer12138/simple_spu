import * as path from 'path';
import { DEFAULT_OUTPUT_FORMAT, OutputFormat } from './types';

export interface AssemblerSettings {
    outputFormat: OutputFormat;
    outputDir: string;
    cKeepAssembly: boolean;
    cDataBase: number;
    cDlbAddrWidth: number;
    cCodeBase: number;
    cOptimization: 'none' | 'basic';
}

export function defaultAssemblerSettings(sourceFile: string): AssemblerSettings {
    return {
        outputFormat: DEFAULT_OUTPUT_FORMAT,
        outputDir: path.dirname(sourceFile),
        cKeepAssembly: true,
        cDataBase: 0x0800_0000,
        cDlbAddrWidth: 16,
        cCodeBase: 0,
        cOptimization: 'basic',
    };
}
