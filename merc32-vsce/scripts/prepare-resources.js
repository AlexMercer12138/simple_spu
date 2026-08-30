const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BASE_RTL_FILES = [
    'rtl/cpu/MERC32_top.v',
    'rtl/cpu/core.v',
    'rtl/debug/jtag_debug.v',
    'rtl/misc/div.v',
    'rtl/misc/mul.v',
    'rtl/misc/spram.v',
    'rtl/bridge/lb2apb.v',
];

function prepareResources(options = {}) {
    const extensionRoot = path.resolve(options.extensionRoot || path.join(__dirname, '..'));
    const repositoryRoot = path.resolve(options.repositoryRoot
        || path.join(__dirname, '..', '..'));
    return prepareResourcesAtRoots({
        ...options,
        extensionRoot,
        repositoryRoot,
    });
}

function prepareResourcesAtRoots(options) {
    const { extensionRoot, repositoryRoot } = requireExplicitRoots(options);
    const inputs = discoverResourceInputs({ extensionRoot, repositoryRoot });
    const resourcesRoot = path.join(extensionRoot, 'resources');
    const socApi = options.socApi || loadSocApi(extensionRoot);
    const { catalogRoot, catalogFiles, rtlFiles: sortedRtlFiles, staticFiles } = inputs;

    const validationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-resource-catalog-'));
    let schemaText;
    try {
        fs.cpSync(catalogRoot, path.join(validationRoot, 'catalog'), { recursive: true });
        for (const logicalPath of sortedRtlFiles) {
            copyLogicalFile(repositoryRoot, validationRoot, logicalPath);
        }
        const catalog = socApi.loadCatalog(validationRoot);
        schemaText = `${JSON.stringify(socApi.generateSocSchema(catalog), null, 2)}\n`;
    } finally {
        fs.rmSync(validationRoot, { recursive: true, force: true });
    }

    const generatedRtlRoot = path.join(resourcesRoot, 'rtl');
    const generatedLicenseRoot = path.join(resourcesRoot, 'licenses');
    const manifestFile = path.join(resourcesRoot, 'resource-manifest.json');
    fs.rmSync(generatedRtlRoot, { recursive: true, force: true });
    fs.rmSync(generatedLicenseRoot, { recursive: true, force: true });
    fs.rmSync(manifestFile, { force: true });
    for (const logicalPath of sortedRtlFiles) {
        copyLogicalFile(repositoryRoot, resourcesRoot, logicalPath);
    }
    fs.mkdirSync(generatedLicenseRoot, { recursive: true });
    fs.copyFileSync(path.join(repositoryRoot, 'LICENSE'),
        path.join(generatedLicenseRoot, 'LICENSE'));
    const schemaFile = path.join(resourcesRoot, 'schema', 'merc32.schema.json');
    fs.mkdirSync(path.dirname(schemaFile), { recursive: true });
    fs.writeFileSync(schemaFile, schemaText);

    const files = [
        ...sortedRtlFiles,
        ...staticFiles,
        'licenses/LICENSE',
        'schema/merc32.schema.json',
    ].sort();
    const sourceRevision = options.sourceRevision || readSourceRevision(repositoryRoot);
    const manifest = {
        manifestVersion: 1,
        sourceRevision,
        files: files.map((logicalPath) => ({
            path: logicalPath,
            sha256: sha256File(path.join(resourcesRoot, ...logicalPath.split('/'))),
        })),
    };
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    return Object.freeze({ files: Object.freeze(files), sourceRevision });
}

function discoverResourceInputs(options) {
    const { extensionRoot, repositoryRoot } = requireExplicitRoots(options);
    const resourcesRoot = path.join(extensionRoot, 'resources');
    const catalogRoot = path.join(resourcesRoot, 'catalog');
    const moduleCatalogRoot = path.join(catalogRoot, 'modules');

    requireExactDirectory(resourcesRoot, resourcesRoot, '.');
    requireExactDirectory(resourcesRoot, catalogRoot, 'catalog');
    requireExactDirectory(resourcesRoot, moduleCatalogRoot, 'catalog/modules');
    requireExactFile(resourcesRoot, path.join(catalogRoot, 'protocols.json'),
        'catalog/protocols.json');

    const catalogFiles = fs.readdirSync(moduleCatalogRoot, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => `catalog/modules/${entry.name}`)
        .sort();
    if (catalogFiles.length === 0) throw new Error('Module catalog is empty.');

    const rtlFiles = new Set(BASE_RTL_FILES);
    for (const logicalPath of catalogFiles) {
        const descriptor = readJson(path.join(resourcesRoot, ...logicalPath.split('/')), logicalPath);
        addCatalogRtlFiles(descriptor, logicalPath, rtlFiles);
    }
    const protocols = readJson(path.join(catalogRoot, 'protocols.json'),
        'catalog/protocols.json');
    if (!Array.isArray(protocols)) throw new Error('catalog/protocols.json must contain an array.');
    protocols.forEach((descriptor, index) => addCatalogRtlFiles(
        descriptor, `catalog/protocols.json[${index}]`, rtlFiles));

    const sortedRtlFiles = [...rtlFiles].sort();
    for (const logicalPath of sortedRtlFiles) {
        requireSourceFile(repositoryRoot, logicalPath);
    }
    const staticFiles = [
        ...catalogFiles,
        'catalog/protocols.json',
        'templates/README.md.tpl',
        'templates/main.c.tpl',
    ].sort();
    for (const logicalPath of staticFiles) {
        requireExactFile(resourcesRoot,
            path.join(resourcesRoot, ...logicalPath.split('/')), logicalPath);
    }
    requireSourceFile(repositoryRoot, 'LICENSE');

    return Object.freeze({
        catalogRoot,
        catalogFiles: Object.freeze(catalogFiles),
        rtlFiles: Object.freeze(sortedRtlFiles),
        staticFiles: Object.freeze(staticFiles),
    });
}

function requireExplicitRoots(options) {
    if (options === null || typeof options !== 'object') {
        throw new TypeError('Resource preparation options are required.');
    }
    return {
        extensionRoot: requireAbsoluteDirectory(options.extensionRoot, 'extension root'),
        repositoryRoot: requireAbsoluteDirectory(options.repositoryRoot, 'repository root'),
    };
}

function requireAbsoluteDirectory(value, label) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) {
        throw new Error(`Resource preparation ${label} must be an absolute path.`);
    }
    const resolved = path.resolve(value);
    const status = fs.lstatSync(resolved);
    if (status.isSymbolicLink() || !status.isDirectory()) {
        throw new Error(`Resource preparation ${label} is not an exact directory: ${resolved}.`);
    }
    return resolved;
}

function addCatalogRtlFiles(descriptor, label, result) {
    if (descriptor === null || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
        throw new Error(`${label} must contain an object.`);
    }
    if (!Array.isArray(descriptor.rtlFiles)) {
        throw new Error(`${label}.rtlFiles must contain an array.`);
    }
    for (const logicalPath of descriptor.rtlFiles) {
        if (typeof logicalPath !== 'string' || !logicalPath.startsWith('rtl/')
            || logicalPath.includes('\\') || logicalPath.split('/').includes('..')) {
            throw new Error(`${label} contains an invalid RTL resource path.`);
        }
        result.add(logicalPath);
    }
}

function loadSocApi(extensionRoot) {
    const typescript = require(path.join(extensionRoot, 'node_modules', 'typescript'));
    const priorLoader = require.extensions['.ts'];
    require.extensions['.ts'] = (module, filename) => {
        const source = fs.readFileSync(filename, 'utf8');
        const output = typescript.transpileModule(source, {
            compilerOptions: {
                esModuleInterop: true,
                module: typescript.ModuleKind.CommonJS,
                target: typescript.ScriptTarget.ES2020,
            },
            fileName: filename,
        });
        module._compile(output.outputText, filename);
    };
    try {
        return require(path.join(extensionRoot, 'src', 'soc', 'index.ts'));
    } finally {
        if (priorLoader === undefined) delete require.extensions['.ts'];
        else require.extensions['.ts'] = priorLoader;
    }
}

function requireSourceFile(root, logicalPath) {
    const components = logicalPath.split('/');
    let current = root;
    for (const component of components) {
        const entries = fs.readdirSync(current, { withFileTypes: true });
        const exact = entries.find((entry) => entry.name === component);
        if (exact === undefined) {
            const insensitive = entries.find((entry) => entry.name.toLowerCase()
                === component.toLowerCase());
            if (insensitive !== undefined) {
                throw new Error(`Case mismatch for resource ${logicalPath}: expected ${component}, found ${insensitive.name}.`);
            }
            throw new Error(`Missing resource ${logicalPath}.`);
        }
        current = path.join(current, exact.name);
    }
    if (!fs.lstatSync(current).isFile()) throw new Error(`Resource is not a file: ${logicalPath}.`);
    return current;
}

function requireExactDirectory(root, target, logicalPath) {
    requireExactPath(root, target, logicalPath, true);
}

function requireExactFile(root, target, logicalPath) {
    requireExactPath(root, target, logicalPath, false);
}

function requireExactPath(root, target, logicalPath, directory) {
    if (!fs.existsSync(target)) throw new Error(`Missing resource ${logicalPath}.`);
    const relative = path.relative(root, target);
    let current = root;
    if (relative !== '') {
        for (const component of relative.split(path.sep)) {
            const entry = fs.readdirSync(current).find((name) => name === component);
            if (entry === undefined) throw new Error(`Case mismatch for resource ${logicalPath}.`);
            current = path.join(current, entry);
        }
    }
    const status = fs.lstatSync(target);
    if (directory ? !status.isDirectory() : !status.isFile()) {
        throw new Error(`Resource has the wrong type: ${logicalPath}.`);
    }
}

function copyLogicalFile(sourceRoot, destinationRoot, logicalPath) {
    const source = path.join(sourceRoot, ...logicalPath.split('/'));
    const destination = path.join(destinationRoot, ...logicalPath.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
}

function readJson(file, logicalPath) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        throw new Error(`Invalid JSON in ${logicalPath}: ${error.message}`);
    }
}

function sha256File(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readSourceRevision(repositoryRoot) {
    const result = spawnSync('git', ['rev-parse', 'HEAD'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
    });
    if (result.status !== 0) {
        throw new Error(`Cannot read source revision: ${result.stderr || result.stdout}`);
    }
    return result.stdout.trim();
}

if (require.main === module) {
    try {
        const result = prepareResources();
        console.log(`Prepared ${result.files.length} MERC32 resources from ${result.sourceRevision}.`);
    } catch (error) {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    }
}

module.exports = {
    discoverResourceInputs,
    loadSocApi,
    prepareResources,
    prepareResourcesAtRoots,
    readSourceRevision,
};
