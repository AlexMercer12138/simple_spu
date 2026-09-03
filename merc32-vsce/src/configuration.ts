import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { EXTENSION_CONFIG_SECTION } from './constants';
import { DEFAULT_OUTPUT_FORMAT, isOutputFormat, OutputFormat } from './types';

export interface AssemblerSettings {
    outputFormat: OutputFormat;
    outputDir: string;
    cKeepAssembly: boolean;
    cDataBase: number;
    cDlbAddrWidth: number;
    cCodeBase: number;
}

export function getAssemblerSettings(sourceFile: string): AssemblerSettings {
    const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
    const rawOutputFormat = config.get<string>('outputFormat', DEFAULT_OUTPUT_FORMAT);
    const customOutputPath = config.get<string>('outputPath', '');

    return {
        outputFormat: isOutputFormat(rawOutputFormat) ? rawOutputFormat : DEFAULT_OUTPUT_FORMAT,
        outputDir: resolveOutputDir(sourceFile, customOutputPath),
        cKeepAssembly: config.get<boolean>('c.keepAssembly', true),
        cDataBase: parseIntegerSetting(config.get<string>('c.dataBase', '0x08000000'), 0x0800_0000),
        cDlbAddrWidth: config.get<number>('c.dlbAddrWidth', 16),
        cCodeBase: parseIntegerSetting(config.get<string>('c.codeBase', '0x00000000'), 0),
    };
}

function parseIntegerSetting(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }
    const trimmed = value.trim();
    const parsed = /^0x/i.test(trimmed)
        ? Number.parseInt(trimmed.slice(2), 16)
        : /^0b/i.test(trimmed)
            ? Number.parseInt(trimmed.slice(2), 2)
            : Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveOutputDir(sourceFile: string, customPath: string): string {
    if (!customPath) {
        return path.dirname(sourceFile);
    }

    const resolved = path.resolve(customPath);
    if (!fs.existsSync(resolved)) {
        fs.mkdirSync(resolved, { recursive: true });
    }
    return resolved;
}
