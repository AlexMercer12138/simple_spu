const fs = require('fs');
const os = require('os');
const path = require('path');

function withOwnedTempRoot(prefix, callback) {
    if (typeof prefix !== 'string' || prefix.length === 0 || path.basename(prefix) !== prefix) {
        throw new Error(`Invalid test temp prefix: ${prefix}`);
    }
    if (typeof callback !== 'function') {
        throw new TypeError('Test temp root callback must be a function');
    }

    const tempParent = fs.realpathSync.native(path.resolve(os.tmpdir()));
    const root = fs.mkdtempSync(path.join(tempParent, prefix));
    let callbackFailed = false;
    let callbackError;
    let result;
    try {
        result = callback(root);
        if (result && typeof result.then === 'function') {
            throw new TypeError('withOwnedTempRoot only supports synchronous callbacks');
        }
    } catch (error) {
        callbackFailed = true;
        callbackError = error;
    }
    try {
        removeOwnedTempRoot(root, tempParent, prefix);
    } catch (cleanupError) {
        if (callbackFailed) {
            throw new AggregateError(
                [callbackError, cleanupError],
                `Test failed and its temp root could not be removed: ${root}`,
            );
        }
        throw cleanupError;
    }
    if (callbackFailed) throw callbackError;
    return result;
}

function removeOwnedTempRoot(root, tempParent, prefix) {
    const resolvedRoot = path.resolve(root);
    if (path.dirname(resolvedRoot) !== tempParent
        || !path.basename(resolvedRoot).startsWith(prefix)) {
        throw new Error(`Refusing to remove unexpected test temp root: ${resolvedRoot}`);
    }
    fs.rmSync(resolvedRoot, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
    });
}

module.exports = { withOwnedTempRoot };
