'use strict';

const assert = require('assert');
const {
    normalizeArchivePath,
    registerArchivePath,
} = require('./test-c-frontend-package');

assert.throws(() => normalizeArchivePath('C:/payload', false), /absolute/u,
    'drive-absolute VSIX paths must be rejected');

{
    const trie = { children: new Map() };
    registerArchivePath(trie, 'extension/file', false);
    assert.throws(() => registerArchivePath(trie, 'extension/file/child', false),
        /descendant is below a file/u,
    'a VSIX entry below an existing file must be rejected');
}

{
    const trie = { children: new Map() };
    registerArchivePath(trie, 'extension/tree/child', false);
    assert.throws(() => registerArchivePath(trie, 'extension/tree', false),
        /existing descendants/u,
    'a VSIX file replacing an implied directory must be rejected');
}

{
    const trie = { children: new Map() };
    registerArchivePath(trie, 'extension/tree/', true);
    assert.throws(() => registerArchivePath(trie, 'extension/tree', false),
        /explicit entry/u,
    'a VSIX path cannot be both a file and directory');
}

process.stdout.write('C frontend optional VSIX path-audit tests passed.\n');
