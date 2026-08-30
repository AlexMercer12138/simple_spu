export const EXTENSION_CONFIG_SECTION = 'merc32-asm';
export const LANGUAGE_ID = 'merc32-asm';
export const C_LANGUAGE_ID = 'c';
export const ASSEMBLY_FILE_EXTENSION = '.asm';
export const C_FILE_EXTENSION = '.c';
export const OUTPUT_CHANNEL_NAME = 'MERC32 Toolchain';

export const COMMANDS = {
    compile: 'merc32-asm.compile',
    compilePrint: 'merc32-asm.compilePrint',
    compileDebug: 'merc32-asm.compileDebug',
    selectCompileMode: 'merc32-asm.selectCompileMode',
    assembleActive: 'merc32-asm.assembleActive',
    compileCToAsm: 'merc32-asm.compileCToAsm',
    buildCToRom: 'merc32-asm.buildCToRom',
    openLastArtifact: 'merc32-asm.openLastArtifact',
    refreshExplorer: 'merc32-asm.refreshExplorer',
} as const;

export const SOC_CONFIG_SUFFIX = '.merc32.json';
export const SOC_DEFAULT_CONFIG_FILE = `soc${SOC_CONFIG_SUFFIX}`;
export const SOC_EDITOR_VIEW_TYPE = 'merc32.socConfigEditor';

export const SOC_VIEW_IDS = {
    configurations: 'merc32-toolchain.configurations',
    generate: 'merc32-toolchain.generate',
    build: 'merc32-toolchain.build',
    artifacts: 'merc32-toolchain.artifacts',
} as const;

export const SOC_COMMANDS = {
    createConfig: 'merc32.soc.createConfig',
    openConfig: 'merc32.soc.openConfig',
    autoAssign: 'merc32.soc.autoAssign',
    validate: 'merc32.soc.validate',
    generate: 'merc32.soc.generate',
    forceGenerate: 'merc32.soc.forceGenerate',
    adoptOutput: 'merc32.soc.adoptOutput',
    openArtifact: 'merc32.soc.openArtifact',
    reopenAsText: 'merc32.soc.reopenAsText',
} as const;

export const SOC_HOST_COMMANDS = {
    refresh: 'merc32.soc.refresh',
} as const;
