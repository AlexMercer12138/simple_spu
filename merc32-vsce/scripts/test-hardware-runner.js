const assert = require('assert');
const { requireExactMarker } = require('./test-hardware');

function result(stdout, stderr = '', status = 0) {
    return { stdout, stderr, status, signal: null };
}

assert.doesNotThrow(() => requireExactMarker(
    'passing bench',
    result('TEST PASS: bench\n'),
    'TEST PASS: bench',
));
assert.doesNotThrow(() => requireExactMarker(
    'invalid width',
    result('', 'CONFIG ERROR: DLB_ADDR_WIDTH must be in range 1..25\n'),
    'CONFIG ERROR: DLB_ADDR_WIDTH must be in range 1..25',
));

for (const [label, simulation, marker] of [
    ['missing marker', result(''), 'TEST PASS: bench'],
    ['wrong marker', result('TEST PASS: another bench\n'), 'TEST PASS: bench'],
    ['duplicate marker', result('TEST PASS: bench\nTEST PASS: bench\n'), 'TEST PASS: bench'],
    ['status-zero assertion failure', result('TEST FAIL: bench failures=1\n'), 'TEST PASS: bench'],
    ['status-zero timeout', result('TEST TIMEOUT: bench\n'), 'TEST PASS: bench'],
    [
        'pass plus failure',
        result('TEST PASS: bench\nTEST FAIL: late assertion\n'),
        'TEST PASS: bench',
    ],
]) {
    assert.throws(
        () => requireExactMarker(label, simulation, marker),
        /expected exactly marker/,
    );
}

console.log('MERC32 hardware runner marker tests passed');
