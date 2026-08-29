const assert = require('assert');
const fs = require('fs');
const path = require('path');

const extensionRoot = path.resolve(__dirname, '..');
const packageLock = JSON.parse(fs.readFileSync(
    path.join(extensionRoot, 'package-lock.json'), 'utf8'));
const ignoreLines = fs.readFileSync(path.join(extensionRoot, '.vscodeignore'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, '/'))
    .filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('!'));

const productionPackages = Object.entries(packageLock.packages)
    .filter(([logicalPath, metadata]) => logicalPath.startsWith('node_modules/') && !metadata.dev)
    .map(([logicalPath]) => logicalPath)
    .sort();

assert.ok(productionPackages.includes('node_modules/ajv'));
assert.ok(productionPackages.includes('node_modules/jsonc-parser'));

for (const logicalPath of productionPackages) {
    assert.ok(fs.existsSync(path.join(extensionRoot, logicalPath, 'package.json')),
        `production dependency is not installed: ${logicalPath}`);
    for (const pattern of ignoreLines) {
        assert.ok(!excludesProductionPackage(pattern, logicalPath),
            `.vscodeignore excludes production dependency ${logicalPath} with ${pattern}`);
    }
}

function excludesProductionPackage(pattern, logicalPath) {
    const normalized = pattern.replace(/^\//, '').replace(/\/$/, '');
    if (normalized.includes('*') && normalized.includes('node_modules')) {
        const prefix = normalized.slice(0, normalized.indexOf('*')).replace(/\/$/, '');
        return prefix === '' || pathsOverlap(prefix, logicalPath);
    }
    return pathsOverlap(normalized, logicalPath);
}

function pathsOverlap(left, right) {
    return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

console.log('VSIX runtime dependency inclusion contract passed.');
