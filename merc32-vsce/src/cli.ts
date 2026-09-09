#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { assembleFile } from './assemblyService';
import { buildCFileToRomDetailed, compileCFileToAssemblyDetailed } from './buildService';
import { CCompileDetailedResult, CompileFileOptions, getCCompileDiagnosticSources, getCCompileSourceFiles } from './cCompiler';
import { SourceRange } from './cFrontend/contract';
import { AssemblerSettings, defaultAssemblerSettings } from './toolchainSettings';
import { COMPILE_MODES, CompileMode, isOutputFormat } from './types';

const HELP = `MERC32 command line toolchain

Usage:
  merc32 build <file.c|file.asm> [options]
  merc32 compile <file.c> [--emit asm] [options]
  merc32 assemble <file.asm> [options]
  merc32 --version

Options:
  --out-dir <directory>      Output directory (default: source directory)
  --format <format>          verilog (default), coe, mif, hex, bin, mem
  --mode <mode>              normal (default), print, debug
  --optimization <level>     basic (default), none
  --code-base <address>      ILB byte address (default: 0x00000000)
  --data-base <address>      DLB byte address (default: 0x08000000)
  --dlb-addr-width <bits>     DLB word address width, 1..25 (default: 16)
  --no-keep-assembly         Do not retain intermediate ASM when building C
  -I <directory>            Additional C include directory (repeatable)
  -D <NAME[=VALUE]>          C macro definition (repeatable; default value: 1)
  -h, --help                Show help

Paths are relative to the current directory. Editor settings are not read.
Exit codes: 0 success, 1 build/I/O failure, 2 invalid command line.
`;

class UsageError extends Error {}
interface Arguments {
    command: 'build' | 'compile' | 'assemble';
    sourceFile: string;
    settings: AssemblerSettings;
    mode: CompileMode;
    compiler: CompileFileOptions;
}

function integer(value: string, flag: string, min: number, max: number): number {
    const parsed = /^(?:0x[0-9a-f]+|0b[01]+|[0-9]+)$/iu.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
        throw new UsageError(`${flag} requires an integer in ${min}..${max}: ${value}`);
    }
    return parsed;
}

function parseArguments(args: readonly string[]): Arguments {
    const command = args[0];
    if (command !== 'build' && command !== 'compile' && command !== 'assemble') {
        throw new UsageError('Expected build, compile, or assemble. Use merc32 --help.');
    }
    const settings = defaultAssemblerSettings('');
    let source: string | undefined;
    let outputDir: string | undefined;
    let mode: CompileMode = 'normal';
    let positional = false;
    const includePaths: string[] = [];
    const defines: Record<string, string> = Object.create(null);
    const flags = new Set<string>();
    for (let i = 1; i < args.length; i++) {
        let arg = args[i];
        if (!positional && arg === '--') { positional = true; continue; }
        if (positional || !arg.startsWith('-')) {
            if (source !== undefined) throw new UsageError('Only one input file is supported.');
            source = arg;
            continue;
        }
        let attached: string | undefined;
        if (/^-[ID].+/u.test(arg)) { attached = arg.slice(2); arg = arg.slice(0, 2); }
        else if (arg.startsWith('--') && arg.includes('=')) {
            const equal = arg.indexOf('='); attached = arg.slice(equal + 1); arg = arg.slice(0, equal);
        }
        flags.add(arg);
        if (arg === '--no-keep-assembly') {
            if (attached !== undefined) throw new UsageError(`${arg} takes no value.`);
            settings.cKeepAssembly = false;
            continue;
        }
        if (!['--out-dir', '--format', '--mode', '--optimization', '--code-base', '--data-base',
            '--dlb-addr-width', '--emit', '-I', '-D'].includes(arg)) {
            throw new UsageError(`Unknown option: ${arg}`);
        }
        const value = attached ?? args[++i];
        if (value === undefined || value === '' || (attached === undefined && value.startsWith('-'))) {
            throw new UsageError(`Missing value for ${arg}.`);
        }
        switch (arg) {
            case '--out-dir': outputDir = path.resolve(value); break;
            case '--format':
                if (!isOutputFormat(value)) throw new UsageError(`Invalid output format: ${value}`);
                settings.outputFormat = value; break;
            case '--mode':
                if (!(COMPILE_MODES as readonly string[]).includes(value)) throw new UsageError(`Invalid mode: ${value}`);
                mode = value as CompileMode; break;
            case '--optimization':
                if (value !== 'basic' && value !== 'none') throw new UsageError(`Invalid optimization: ${value}`);
                settings.cOptimization = value; break;
            case '--code-base': settings.cCodeBase = integer(value, arg, 0, 0x7fff); break;
            case '--data-base': settings.cDataBase = integer(value, arg, 0, 0xffffffff); break;
            case '--dlb-addr-width': settings.cDlbAddrWidth = integer(value, arg, 1, 25); break;
            case '--emit':
                if (command !== 'compile' || value !== 'asm') throw new UsageError('--emit asm is supported only by compile.');
                break;
            case '-I': includePaths.push(path.resolve(value)); break;
            case '-D': {
                const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:=([\s\S]*))?$/u.exec(value);
                if (!match) throw new UsageError(`Invalid macro definition: ${value}`);
                defines[match[1]] = match[2] ?? '1'; break;
            }
        }
    }
    if (!source) throw new UsageError('An input file is required.');
    const sourceFile = path.resolve(source);
    const extension = path.extname(sourceFile).toLowerCase();
    if (!['.c', '.asm'].includes(extension) || (command === 'compile' && extension !== '.c')
        || (command === 'assemble' && extension !== '.asm')) {
        throw new UsageError(`${command} does not support input ${source}.`);
    }
    if (command === 'compile' && ['--format', '--mode', '--no-keep-assembly'].some(flag => flags.has(flag))) {
        throw new UsageError('compile emits ASM; --format, --mode and --no-keep-assembly apply to ROM builds.');
    }
    if (extension === '.asm' && ['-I', '-D', '--optimization', '--code-base', '--data-base',
        '--dlb-addr-width', '--no-keep-assembly'].some(flag => flags.has(flag))) {
        throw new UsageError('C compiler options cannot be used with ASM input; use ASM directives for addresses.');
    }
    settings.outputDir = outputDir ?? path.dirname(sourceFile);
    return { command, sourceFile, settings, mode, compiler: { includePaths, defines } };
}

function printDiagnostics<T>(result: CCompileDetailedResult<T>, fallback: string): void {
    const files = new Map(getCCompileSourceFiles(result).map(file => [Number(file.id), file.path]));
    for (const source of getCCompileDiagnosticSources(result)) files.set(Number(source.file.id), source.canonicalPath);
    const location = (range: SourceRange) => `${files.get(Number(range.file)) ?? fallback}:${range.start.line}:${range.start.column}`;
    for (const diagnostic of result.diagnostics) {
        process.stderr.write(`${location(diagnostic.range)}: ${diagnostic.severity} [${diagnostic.code}]: ${diagnostic.message}\n`);
        for (const note of diagnostic.notes) process.stderr.write(`  note: ${note}\n`);
        for (const related of diagnostic.related) process.stderr.write(`${location(related.range)}: note: ${related.message}\n`);
        for (const range of diagnostic.includeTrace) process.stderr.write(`${location(range)}: note: Included from here\n`);
        for (const range of diagnostic.macroExpansionTrace) process.stderr.write(`${location(range)}: note: Expanded from macro here\n`);
    }
}

export function runCli(args: readonly string[] = process.argv.slice(2)): number {
    try {
        if (args.length === 1 && args[0] === '--version') {
            const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
            process.stdout.write(`${manifest.version}\n`);
            return 0;
        }
        if (args.includes('--help') || args.includes('-h')) { process.stdout.write(HELP); return 0; }
        const { command, sourceFile, settings, mode, compiler } = parseArguments(args);
        if (path.extname(sourceFile).toLowerCase() === '.asm') {
            const result = assembleFile(fs.readFileSync(sourceFile, 'utf8'), sourceFile,
                settings.outputFormat, mode, settings.outputDir);
            process.stdout.write(`${mode === 'print' ? result.output.toString() : result.outputFile}\n`);
            return 0;
        }
        if (command === 'compile') {
            const result = compileCFileToAssemblyDetailed(sourceFile, settings, compiler);
            printDiagnostics(result, sourceFile);
            if (!result.artifact) return result.diagnostics.some(item => item.code === 'MERC32_C_OPTION') ? 2 : 1;
            process.stdout.write(`${result.artifact.assemblyFile}\n`);
        } else {
            const result = buildCFileToRomDetailed(sourceFile, mode, settings, compiler);
            printDiagnostics(result, sourceFile);
            if (!result.artifact) return result.diagnostics.some(item => item.code === 'MERC32_C_OPTION') ? 2 : 1;
            if (mode === 'print') process.stdout.write(`${result.artifact.assemblyResult.output.toString()}\n`);
            else for (const artifact of result.artifact.artifacts) process.stdout.write(`${artifact.file}\n`);
        }
        return 0;
    } catch (error) {
        process.stderr.write(`merc32: ${error instanceof Error ? error.message : String(error)}\n`);
        return error instanceof UsageError ? 2 : 1;
    }
}

if (require.main === module) process.exitCode = runCli();
