const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const sourceRoot = path.resolve(process.argv[2] || path.join(__dirname, '../../../ip-repo'));
const destination = path.resolve(__dirname, '../resources/drivers');
const names = ['can', 'gpio', 'i2c', 'intc', 'qspi', 'sdio', 'timer', 'uart'];
const files = names.flatMap(name => ['c', 'h'].map(ext => {
    const source = `${name}/drivers/${name}.${ext}`;
    return { source, name: `${name}.${ext}`, bytes: fs.readFileSync(path.join(sourceRoot, source)) };
}));
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8', windowsHide: true }).trim();
const dirty = execFileSync('git', ['status', '--porcelain', '--', ...files.map(file => file.source)],
    { cwd: sourceRoot, encoding: 'utf8', windowsHide: true }).trim() !== '';
fs.mkdirSync(destination, { recursive: true });
for (const file of files) fs.writeFileSync(path.join(destination, file.name), file.bytes);
fs.writeFileSync(path.join(destination, 'provenance.json'), `${JSON.stringify({
    repository: 'ip-repo', revision, dirty,
    files: files.map(file => ({ source: file.source, path: file.name,
        sha256: crypto.createHash('sha256').update(file.bytes).digest('hex') })),
}, null, 2)}\n`);
console.log(`Synchronized ${files.length} driver files from ip-repo ${revision}${dirty ? ' (working tree)' : ''}.`);
