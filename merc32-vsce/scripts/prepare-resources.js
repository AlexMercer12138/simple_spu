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
const DEFAULT_EXTENSION_ROOT = path.resolve(__dirname, '..');
const DEFAULT_REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');

function prepareResources(options = {}) {
    requireOptions(options);
    const extensionRoot = resolveWrapperRoot(
        options,
        'extensionRoot',
        DEFAULT_EXTENSION_ROOT,
        'extension root',
    );
    const repositoryRoot = resolveWrapperRoot(
        options,
        'repositoryRoot',
        DEFAULT_REPOSITORY_ROOT,
        'repository root',
    );
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
    validateConcreteResourceTopology({ extensionRoot, repositoryRoot }, inputs);

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
    for (const logicalPath of sortedRtlFiles) {
        copyLogicalFile(repositoryRoot, resourcesRoot, logicalPath);
    }
    fs.mkdirSync(generatedLicenseRoot, { recursive: true });
    fs.copyFileSync(path.join(repositoryRoot, 'LICENSE'),
        path.join(generatedLicenseRoot, 'LICENSE'));
    const schemaFile = path.join(resourcesRoot, 'schema', 'merc32.schema.json');
    fs.mkdirSync(path.dirname(schemaFile), { recursive: true });
    writeFileAtomically(schemaFile, schemaText);

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
    writeFileAtomically(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
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
        'webview/socEditor.css',
        'webview/socEditor.js',
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
    requireOptions(options);
    const roots = {
        extensionRoot: requireAbsoluteDirectory(options.extensionRoot, 'extension root'),
        repositoryRoot: requireAbsoluteDirectory(options.repositoryRoot, 'repository root'),
    };
    validateResourceRootTopology(roots);
    return roots;
}

function requireAbsoluteDirectory(value, label) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) {
        throw new Error(`Resource preparation ${label} must be an absolute path.`);
    }
    const resolved = path.resolve(value);
    assertPathHasNoLinks(resolved, label);
    const status = fs.lstatSync(resolved);
    if (status.isSymbolicLink() || !status.isDirectory()) {
        throw new Error(`Resource preparation ${label} is not an exact directory: ${resolved}.`);
    }
    const canonical = fs.realpathSync.native(resolved);
    if (!sameCanonicalPath(resolved, canonical)) {
        throw new Error(`Resource preparation ${label} is linked or redirected: ${resolved}.`);
    }
    return canonical;
}

function resolveWrapperRoot(options, key, fallback, label) {
    if (!Object.prototype.hasOwnProperty.call(options, key)) return fallback;
    const value = options[key];
    if (typeof value !== 'string' || !path.isAbsolute(value)) {
        throw new Error(`Resource preparation ${label} override must be an absolute path.`);
    }
    return value;
}

function validateResourceRootTopology(roots) {
    const resourcesRoot = path.join(roots.extensionRoot, 'resources');
    const inputs = [
        { label: 'repository RTL input', target: path.join(roots.repositoryRoot, 'rtl') },
        { label: 'repository license input', target: path.join(roots.repositoryRoot, 'LICENSE') },
        { label: 'extension catalog input', target: path.join(resourcesRoot, 'catalog') },
        { label: 'extension templates input', target: path.join(resourcesRoot, 'templates') },
        { label: 'extension webview input', target: path.join(resourcesRoot, 'webview') },
    ];
    const outputs = [
        { label: 'generated RTL output', target: path.join(resourcesRoot, 'rtl') },
        { label: 'generated licenses output', target: path.join(resourcesRoot, 'licenses') },
        { label: 'generated manifest output', target: path.join(resourcesRoot,
            'resource-manifest.json') },
        { label: 'generated schema output', target: path.join(resourcesRoot,
            'schema', 'merc32.schema.json') },
    ];

    if (samePathOrIdentity(roots.repositoryRoot, roots.extensionRoot)) {
        throw new Error('Unsafe resource root topology: repository and extension roots are identical.');
    }
    for (const entry of [...inputs, ...outputs]) {
        assertPathHasNoLinks(entry.target, entry.label);
    }
    for (const output of outputs) {
        for (const input of inputs) {
            if (pathsOverlap(output.target, input.target)
                || sameExistingIdentity(output.target, input.target)) {
                throw new Error(
                    `Unsafe resource root topology: ${output.label} overlaps ${input.label}.`,
                );
            }
        }
    }
    for (let index = 0; index < inputs.length; index += 1) {
        for (let otherIndex = index + 1; otherIndex < inputs.length; otherIndex += 1) {
            if (pathsOverlap(inputs[index].target, inputs[otherIndex].target)
                || sameExistingIdentity(inputs[index].target, inputs[otherIndex].target)) {
                throw new Error(
                    `Unsafe resource root topology: ${inputs[index].label} overlaps ${inputs[otherIndex].label}.`,
                );
            }
        }
    }
    for (let index = 0; index < outputs.length; index += 1) {
        for (let otherIndex = index + 1; otherIndex < outputs.length; otherIndex += 1) {
            if (pathsOverlap(outputs[index].target, outputs[otherIndex].target)
                || sameExistingIdentity(outputs[index].target, outputs[otherIndex].target)) {
                throw new Error(
                    `Unsafe resource root topology: ${outputs[index].label} overlaps ${outputs[otherIndex].label}.`,
                );
            }
        }
    }
}

function validateConcreteResourceTopology(roots, inputs) {
    const resourcesRoot = path.join(roots.extensionRoot, 'resources');
    const authoritativeInputs = [
        ...inputs.staticFiles.map((logicalPath) => ({
            label: `extension resource input ${logicalPath}`,
            target: path.join(resourcesRoot, ...logicalPath.split('/')),
        })),
        ...inputs.rtlFiles.map((logicalPath) => ({
            label: `repository RTL input ${logicalPath}`,
            target: path.join(roots.repositoryRoot, ...logicalPath.split('/')),
        })),
        {
            label: 'repository license input LICENSE',
            target: path.join(roots.repositoryRoot, 'LICENSE'),
        },
    ];
    const writeTargets = [
        ...inputs.rtlFiles.map((logicalPath) => ({
            label: `generated RTL output ${logicalPath}`,
            target: path.join(resourcesRoot, ...logicalPath.split('/')),
        })),
        {
            label: 'generated license output licenses/LICENSE',
            target: path.join(resourcesRoot, 'licenses', 'LICENSE'),
        },
        {
            label: 'generated manifest output resource-manifest.json',
            target: path.join(resourcesRoot, 'resource-manifest.json'),
        },
        {
            label: 'generated schema output schema/merc32.schema.json',
            target: path.join(resourcesRoot, 'schema', 'merc32.schema.json'),
        },
    ];

    for (const output of writeTargets) {
        assertPathHasNoLinks(output.target, output.label);
        for (const input of authoritativeInputs) {
            if (pathsOverlap(output.target, input.target)
                || sameExistingIdentity(output.target, input.target)) {
                throw new Error(
                    `Unsafe resource topology: ${output.label} aliases ${input.label}.`,
                );
            }
        }
    }
}

function assertPathHasNoLinks(value, label) {
    const resolved = path.resolve(value);
    const parsed = path.parse(resolved);
    let current = parsed.root;
    const components = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
    for (const component of components) {
        current = path.join(current, component);
        let status;
        try {
            status = fs.lstatSync(current);
        } catch (error) {
            if (error.code === 'ENOENT') return;
            throw error;
        }
        if (status.isSymbolicLink()) {
            throw new Error(`Resource preparation ${label} is linked or redirected: ${current}.`);
        }
        const canonical = fs.realpathSync.native(current);
        if (!sameCanonicalPath(current, canonical)) {
            throw new Error(`Resource preparation ${label} is linked or redirected: ${current}.`);
        }
    }
}

function pathsOverlap(left, right) {
    return isSameOrDescendant(left, right) || isSameOrDescendant(right, left);
}

function isSameOrDescendant(root, candidate) {
    const relative = path.relative(pathComparisonKey(root), pathComparisonKey(candidate));
    return relative === '' || (!path.isAbsolute(relative)
        && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function samePathOrIdentity(left, right) {
    return pathComparisonKey(left) === pathComparisonKey(right)
        || sameExistingIdentity(left, right);
}

function sameExistingIdentity(left, right) {
    const leftStatus = lstatOptional(left, true);
    const rightStatus = lstatOptional(right, true);
    return leftStatus !== undefined && rightStatus !== undefined
        && leftStatus.dev === rightStatus.dev && leftStatus.ino === rightStatus.ino;
}

function pathComparisonKey(value) {
    const normalized = path.normalize(path.resolve(value));
    return process.platform === 'win32'
        ? normalized.toLocaleLowerCase('en-US')
        : normalized;
}

function sameCanonicalPath(left, right) {
    return pathComparisonKey(left) === pathComparisonKey(right);
}

function lstatOptional(target, bigint = false) {
    try {
        return fs.lstatSync(target, bigint ? { bigint: true } : undefined);
    } catch (error) {
        if (error.code === 'ENOENT') return undefined;
        throw error;
    }
}

function requireOptions(options) {
    if (options === null || typeof options !== 'object') {
        throw new TypeError('Resource preparation options are required.');
    }
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

function writeFileAtomically(target, contents) {
    const temporary = path.join(
        path.dirname(target),
        `.${path.basename(target)}.tmp-${process.pid}-${crypto.randomBytes(12).toString('hex')}`,
    );
    let descriptor;
    try {
        descriptor = fs.openSync(temporary, 'wx');
        fs.writeFileSync(descriptor, contents);
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = undefined;
        fs.renameSync(temporary, target);
    } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
        fs.rmSync(temporary, { force: true });
    }
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
