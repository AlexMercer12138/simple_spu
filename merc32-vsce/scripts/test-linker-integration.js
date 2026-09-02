const assert = require('assert');
const { linkObjects } = require('../out/linker');
const object = (name, text) => ({ version:1,target:'merc32',abi:'merc32-c-v1',sections:[{name:'text',alignment:4,size:text.length,content:text}],symbols:[{name,binding:'global',section:'text',offset:0,defined:true}],relocations:[] });
const image = linkObjects([object('main', 'main:\n'), object('helper', 'helper:\n')]);
assert(image.assembly.includes('main:'));
assert.strictEqual(image.symbols.get('helper'), 6);
console.log('linker integration tests passed');
