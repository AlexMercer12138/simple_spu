const assert = require('assert');
const { serializeObject, deserializeObject, validateObject } = require('../out/linker/objectJson');
const object = { version: 1, target: 'merc32', abi: 'merc32-c-v1', sections: [{ name: 'text', alignment: 4, size: 4, content: [1,2,3,4] }, { name: 'bss', alignment: 4, size: 8 }], symbols: [{ name: 'main', binding: 'global', section: 'text', offset: 0, defined: true }, { name: 'ext', binding: 'global', defined: false }], relocations: [{ section: 'text', offset: 0, kind: 'CALL16', symbol: 'ext', addend: 0, debug: { file: 'x.c', line: 1, column: 1 } }] };
assert.deepStrictEqual(deserializeObject(serializeObject(object)), object);
assert.throws(() => validateObject({ ...object, version: 2 }));
assert.throws(() => validateObject({ ...object, sections: [{ name: 'bad', alignment: 1, size: 0 }] }));
console.log('mobj format tests passed');
