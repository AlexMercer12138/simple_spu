const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../runtime/merc32');
for (const file of ['startup.asm','mem.asm','float32.asm','float64.asm','runtime.manifest.json','PROVENANCE.md']) assert(fs.existsSync(path.join(root, file)), file);
console.log('runtime packaging tests passed');
