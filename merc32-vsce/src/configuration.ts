import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { EXTENSION_CONFIG_SECTION } from './constants';
import { isOutputFormat } from './types';
import { AssemblerSettings, defaultAssemblerSettings } from './toolchainSettings';
export type { AssemblerSettings } from './toolchainSettings';

export function getAssemblerSettings(sourceFile: string): AssemblerSettings {
    const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
    const defaults = defaultAssemblerSettings(sourceFile);
    const rawOutputFormat = config.get<string>('outputFormat', defaults.outputFormat);
    const customOutputPath = config.get<string>('outputPath', '');

    return {
        outputFormat: isOutputFormat(rawOutputFormat) ? rawOutputFormat : defaults.outputFormat,
        outputDir: resolveOutputDir(sourceFile, customOutputPath),
        cKeepAssembly: config.get<boolean>('c.keepAssembly', defaults.cKeepAssembly),
        cDataBase: parseIntegerSetting(config.get<string>('c.dataBase'), defaults.cDataBase),
        cDlbAddrWidth: config.get<number>('c.dlbAddrWidth', defaults.cDlbAddrWidth),
        cCodeBase: parseIntegerSetting(config.get<string>('c.codeBase'), defaults.cCodeBase),
        cOptimization: config.get<'none' | 'basic'>('c.optimization', defaults.cOptimization),
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
