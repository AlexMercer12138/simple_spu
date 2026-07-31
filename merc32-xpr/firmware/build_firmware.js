const fs = require('fs');
const path = require('path');

const { compileC } = require('../../merc32-vsce/out/cCompiler');
const { SimpleCPUAssembler } = require('../../merc32-vsce/out/assembler');

function parseOutputDirectory(argumentsList) {
    if (argumentsList.length !== 2 ||
        argumentsList[0] !== '--output-dir' ||
        argumentsList[1].length === 0) {
        throw new Error('usage: build_firmware.js --output-dir <path>');
    }
    return path.resolve(argumentsList[1]);
}

function buildFirmware(outputDirectory) {
    const sourcePath = path.join(__dirname, 'peripheral_test.c');
    const assemblyPath = path.join(outputDirectory, 'peripheral_test.asm');
    const memoryPath = path.join(outputDirectory, 'peripheral_test.mem');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const compiled = compileC(source, {
        moduleName: 'peripheral_test',
        dataBase: 0x00800000,
        dlbAddrWidth: 16,
    });
    const assembled = new SimpleCPUAssembler().assemble(compiled.assembly, {
        sourceFileName: sourcePath,
    });

    if (assembled.machineCodes.length === 0) {
        throw new Error('firmware image is empty');
    }
    if (assembled.machineCodes.length > 65536) {
        throw new Error('firmware image exceeds 65536 words');
    }

    const memoryImage = assembled.machineCodes
        .map((word) => (word >>> 0).toString(16).padStart(8, '0'))
        .join('\n') + '\n';

    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(assemblyPath, compiled.assembly, 'utf8');
    fs.writeFileSync(memoryPath, memoryImage, 'utf8');

    console.log(`assembly: ${assemblyPath}`);
    console.log(`memory: ${memoryPath}`);
    console.log(`words: ${assembled.machineCodes.length}`);
}

try {
    buildFirmware(parseOutputDirectory(process.argv.slice(2)));
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
