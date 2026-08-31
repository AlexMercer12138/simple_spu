'use strict';

const assert = require('assert');
const { SocEditorSession } = require('../out/socEditorSession');

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolveValue, rejectValue) => {
        resolve = resolveValue;
        reject = rejectValue;
    });
    return { promise, resolve, reject };
}

function latestState(messages) {
    return [...messages].reverse().find((message) => message.type === 'state');
}

async function waitFor(predicate) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail('session condition did not settle');
}

function createSessionServices(overrides = {}) {
    let documentVersion = 1;
    let documentState = 'saved';
    return {
        currentDocumentVersion: () => documentVersion,
        setDocumentVersion: (value) => { documentVersion = value; },
        setDocumentState: (value) => { documentState = value; },
        normalizeSelection: (path) => [...path],
        buildState: (selectedPath, generation) => ({
            documentVersion,
            documentState,
            readOnly: false,
            catalog: { modules: [], externalInterfaces: [] },
            diagnostics: [],
            selectedPath,
            addressRows: [],
            interruptRows: [],
            portRows: [],
            dependencyRows: [],
            interruptOptions: { controllers: [], directSources: [], routedSources: [] },
            generation,
        }),
        postMessage: async () => true,
        mutate: async () => true,
        executeAction: async () => true,
        reopenAsText: async () => {},
        ...overrides,
    };
}

async function testSelectionBypassesActionAndDuplicateIsIgnored() {
    const deferred = createDeferred();
    const posted = [];
    const actions = [];
    const services = createSessionServices({
        postMessage: async (message) => { posted.push(message); return true; },
        executeAction: async (type, report) => {
            actions.push(type);
            await report({
                actionId: 0,
                action: 'validate',
                phase: 'generating',
                message: 'Running generator...',
            });
            return deferred.promise;
        },
    });
    const session = new SocEditorSession(services);

    await session.receive({ type: 'ready' });
    await session.receive({ type: 'generate' });
    await session.receive({ type: 'select', path: ['project'] });
    assert.deepStrictEqual(latestState(posted).value.selectedPath, ['project']);
    assert.strictEqual(actions.length, 1);
    const progress = posted.find((message) => message.type === 'generationStatus');
    assert.strictEqual(progress.actionId, 1, 'command placeholder action ID escaped the session');
    assert.strictEqual(progress.action, 'generate', 'command progress changed the active action identity');

    await session.receive({ type: 'generate' });
    assert.strictEqual(actions.length, 1, 'duplicate Generate started a second action');

    deferred.resolve(true);
    await waitFor(() => latestState(posted).value.generation.phase === 'generated');
    await session.receive({ type: 'select', path: ['interrupt'] });
    assert.deepStrictEqual(latestState(posted).value.selectedPath, ['interrupt']);
}

async function testActiveActionSurvivesMutationErrorAndAcknowledgesDuplicate() {
    const deferred = createDeferred();
    const posted = [];
    let actionCalls = 0;
    const services = createSessionServices({
        postMessage: async (message) => { posted.push(message); return true; },
        executeAction: async (type, report) => {
            actionCalls += 1;
            await report({ phase: 'generating', message: 'Generating SoC...' });
            return deferred.promise;
        },
    });
    const session = new SocEditorSession(services);

    await session.receive({ type: 'ready' });
    await session.receive({ type: 'generate' });
    await waitFor(() => posted.some((message) => message.type === 'generationStatus'
        && message.actionId === 1 && message.phase === 'generating'));

    services.setDocumentVersion(2);
    await session.receive({
        type: 'setValue', documentVersion: 1, path: ['project', 'name'], value: 'stale',
    });
    assert.deepStrictEqual(latestState(posted).value.generation, {
        actionId: 1,
        action: 'generate',
        phase: 'generating',
        message: 'Generating SoC...',
    }, 'stale mutation replaced the unresolved Generate status');

    const statusCount = posted.filter((message) => message.type === 'generationStatus').length;
    await session.receive({ type: 'generate' });
    const duplicateAcknowledgment = posted.filter((message) =>
        message.type === 'generationStatus').slice(statusCount);
    assert.deepStrictEqual(duplicateAcknowledgment, [{
        type: 'generationStatus',
        actionId: 1,
        action: 'generate',
        phase: 'generating',
        message: 'Generating SoC...',
    }], 'duplicate action request did not receive the current active status');
    assert.strictEqual(actionCalls, 1, 'duplicate Generate started a second action');

    deferred.resolve(true);
    await waitFor(() => latestState(posted).value.generation.phase === 'generated');
    assert.deepStrictEqual(latestState(posted).value.generation, {
        actionId: 1,
        action: 'generate',
        phase: 'generated',
        message: 'SoC generation completed.',
    });
}

async function testRejectedActionBecomesErrorAndReleasesLane() {
    const posted = [];
    let attempts = 0;
    const session = new SocEditorSession(createSessionServices({
        postMessage: async (message) => { posted.push(message); return true; },
        executeAction: async (type, report) => {
            attempts += 1;
            await report({ phase: 'validating', message: 'Checking...' });
            if (attempts === 1) throw new Error('validation rejected');
            if (attempts === 2) return false;
            return true;
        },
    }));

    await session.receive({ type: 'ready' });
    await session.receive({ type: 'validate' });
    await waitFor(() => latestState(posted).value.generation.phase === 'error');
    assert.strictEqual(latestState(posted).value.generation.action, 'validate');

    await session.receive({ type: 'validate' });
    await waitFor(() => latestState(posted).value.generation.actionId === 2
        && latestState(posted).value.generation.phase === 'error');

    await session.receive({ type: 'validate' });
    await waitFor(() => attempts === 3 && latestState(posted).value.generation.phase === 'success');
}

async function testReportedActionFailureIsNotOverwrittenByVoidOutcome() {
    const posted = [];
    const session = new SocEditorSession(createSessionServices({
        postMessage: async (message) => { posted.push(message); return true; },
        executeAction: async (type, report) => {
            await report({ phase: 'generating', message: 'Generating...' });
            await report({ phase: 'error', message: 'SoC generation failed.' });
        },
    }));

    await session.receive({ type: 'ready' });
    await session.receive({ type: 'generate' });
    await waitFor(() => latestState(posted).value.generation.phase === 'error');
    assert.strictEqual(latestState(posted).value.generation.action, 'generate');
}

async function testReportedActionFailureSurvivesFalseAndThrow() {
    for (const outcome of ['false', 'throw']) {
        const posted = [];
        const session = new SocEditorSession(createSessionServices({
            postMessage: async (message) => { posted.push(message); return true; },
            executeAction: async (type, report) => {
                await report({ phase: 'generating', message: 'Generating...' });
                await report({ phase: 'error', message: `Command-specific ${outcome} failure.` });
                if (outcome === 'throw') throw new Error('wrapper failure');
                return false;
            },
        }));

        await session.receive({ type: 'ready' });
        await session.receive({ type: 'generate' });
        await waitFor(() => posted.filter((message) => message.type === 'state').length === 2);
        assert.strictEqual(
            latestState(posted).value.generation.message,
            `Command-specific ${outcome} failure.`,
            `${outcome} outcome overwrote a command-reported terminal error`,
        );
    }
}

async function testReceiveContainsSelectionNormalizerFailure() {
    const posted = [];
    const session = new SocEditorSession(createSessionServices({
        normalizeSelection: () => { throw new Error('normalizer failed'); },
        postMessage: async (message) => { posted.push(message); return true; },
    }));

    await session.receive({ type: 'ready' });
    await assert.doesNotReject(session.receive({ type: 'select', path: ['project'] }));
    assert.strictEqual(latestState(posted).value.generation.phase, 'error');
    assert.strictEqual(
        latestState(posted).value.generation.message,
        'The editor could not process that request.',
    );
}

async function testDocumentVersionChangeRefreshesOnce() {
    const posted = [];
    const services = createSessionServices({
        postMessage: async (message) => { posted.push(message); return true; },
    });
    const session = new SocEditorSession(services);

    await session.receive({ type: 'ready' });
    services.setDocumentVersion(2);
    await session.documentChanged();
    assert.strictEqual(latestState(posted).value.documentVersion, 2);

    const stateCount = posted.filter((message) => message.type === 'state').length;
    await session.documentChanged();
    assert.strictEqual(posted.filter((message) => message.type === 'state').length, stateCount,
        'unchanged document version posted a redundant state');
}

async function testForcedPresentationRefreshAllowsSameDocumentVersion() {
    const posted = [];
    const services = createSessionServices({
        postMessage: async (message) => { posted.push(message); return true; },
    });
    services.setDocumentState('dirty');
    const session = new SocEditorSession(services);

    await session.receive({ type: 'ready' });
    assert.strictEqual(latestState(posted).value.documentState, 'dirty');

    services.setDocumentState('saved');
    await session.presentationChanged();
    assert.strictEqual(latestState(posted).value.documentState, 'saved',
        'forced same-version presentation refresh was suppressed');
    assert.strictEqual(latestState(posted).value.documentVersion, 1);
}

async function testQueuedMutationRechecksVersionAndRefreshes() {
    const firstMutation = createDeferred();
    const posted = [];
    const mutatedVersions = [];
    const services = createSessionServices({
        postMessage: async (message) => { posted.push(message); return true; },
        mutate: async (message) => {
            mutatedVersions.push(message.documentVersion);
            if (mutatedVersions.length === 1) return firstMutation.promise;
            return true;
        },
    });
    const session = new SocEditorSession(services);

    await session.receive({ type: 'ready' });
    const first = session.receive({
        type: 'setValue', documentVersion: 1, path: ['project', 'name'], value: 'first',
    });
    let firstSettled = false;
    void first.then(() => { firstSettled = true; });
    await waitFor(() => mutatedVersions.length === 1);
    await session.receive({ type: 'select', path: ['interrupt'] });
    assert.deepStrictEqual(latestState(posted).value.selectedPath, ['interrupt']);
    assert.strictEqual(firstSettled, false, 'selection waited for the unresolved mutation');

    const stale = session.receive({
        type: 'setValue', documentVersion: 1, path: ['project', 'name'], value: 'stale',
    });
    services.setDocumentVersion(2);
    firstMutation.resolve(true);
    await Promise.all([first, stale]);

    assert.deepStrictEqual(mutatedVersions, [1], 'stale queued mutation reached the document');
    assert.strictEqual(latestState(posted).value.documentVersion, 2);
    assert.strictEqual(latestState(posted).value.generation.phase, 'error');
    assert.match(latestState(posted).value.generation.message, /configuration changed/i);
}

async function testMutationRejectionRefreshesAndQueueRecovers() {
    const posted = [];
    let calls = 0;
    const session = new SocEditorSession(createSessionServices({
        postMessage: async (message) => { posted.push(message); return true; },
        mutate: async () => {
            calls += 1;
            if (calls === 1) throw new Error('Invalid JSON is read-only. Reopen as text to repair it.');
            return true;
        },
    }));

    await session.receive({ type: 'ready' });
    await session.receive({
        type: 'setValue', documentVersion: 1, path: ['project', 'name'], value: 'rejected',
    });
    assert.match(latestState(posted).value.generation.message, /Invalid JSON is read-only/);

    await session.receive({
        type: 'setValue', documentVersion: 1, path: ['project', 'name'], value: 'accepted',
    });
    assert.strictEqual(calls, 2, 'mutation rejection poisoned the serial queue');
}

async function testStatePostsStayOrderedAndPendingRefreshesCoalesce() {
    const firstPost = createDeferred();
    const posted = [];
    let postCount = 0;
    const session = new SocEditorSession(createSessionServices({
        postMessage: async (message) => {
            posted.push(message);
            postCount += 1;
            if (postCount === 1) await firstPost.promise;
            return true;
        },
    }));

    const ready = session.receive({ type: 'ready' });
    await waitFor(() => posted.length === 1);
    const firstSelection = session.receive({ type: 'select', path: ['project'] });
    const secondSelection = session.receive({ type: 'select', path: ['interrupt'] });
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(posted.length, 1, 'a newer state post overtook the unresolved first post');
    firstPost.resolve(true);
    await Promise.all([ready, firstSelection, secondSelection]);

    const states = posted.filter((message) => message.type === 'state');
    assert.strictEqual(states.length, 2, 'superseded queued state was not coalesced');
    assert.deepStrictEqual(states[1].value.selectedPath, ['interrupt']);
}

async function testRejectedPostDoesNotPoisonStateDelivery() {
    const posted = [];
    let attempts = 0;
    const session = new SocEditorSession(createSessionServices({
        postMessage: async (message) => {
            attempts += 1;
            if (attempts === 1) throw new Error('panel temporarily unavailable');
            posted.push(message);
            return true;
        },
    }));

    await session.receive({ type: 'ready' });
    await session.receive({ type: 'select', path: ['project'] });
    assert.strictEqual(attempts, 2);
    assert.deepStrictEqual(latestState(posted).value.selectedPath, ['project']);
}

async function testDisposeSuppressesQueuedAndActionCompletionPosts() {
    const firstPost = createDeferred();
    const action = createDeferred();
    const posted = [];
    let postCount = 0;
    const services = createSessionServices({
        postMessage: async (message) => {
            posted.push(message);
            postCount += 1;
            if (postCount === 1) await firstPost.promise;
            return true;
        },
        executeAction: async () => action.promise,
    });
    const session = new SocEditorSession(services);

    const ready = session.receive({ type: 'ready' });
    await waitFor(() => posted.length === 1);
    const changed = session.documentChanged();
    await session.receive({ type: 'generate' });
    session.dispose();
    firstPost.resolve(true);
    action.resolve(true);
    await Promise.all([ready, changed]);
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(posted.length, 1, 'disposed session posted queued or action completion state');
    await session.receive({ type: 'select', path: ['project'] });
    assert.strictEqual(posted.length, 1, 'disposed session accepted a new message');
}

async function main() {
    await testSelectionBypassesActionAndDuplicateIsIgnored();
    await testActiveActionSurvivesMutationErrorAndAcknowledgesDuplicate();
    await testRejectedActionBecomesErrorAndReleasesLane();
    await testReportedActionFailureIsNotOverwrittenByVoidOutcome();
    await testReportedActionFailureSurvivesFalseAndThrow();
    await testReceiveContainsSelectionNormalizerFailure();
    await testDocumentVersionChangeRefreshesOnce();
    await testForcedPresentationRefreshAllowsSameDocumentVersion();
    await testQueuedMutationRechecksVersionAndRefreshes();
    await testMutationRejectionRefreshesAndQueueRecovers();
    await testStatePostsStayOrderedAndPendingRefreshesCoalesce();
    await testRejectedPostDoesNotPoisonStateDelivery();
    await testDisposeSuppressesQueuedAndActionCompletionPosts();
    console.log('SoC editor session scheduling tests passed.');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
