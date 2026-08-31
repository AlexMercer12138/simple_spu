const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const { renderEditorHtml } = require('../out/socEditorProvider');

const scriptPath = path.join(__dirname, '..', 'resources', 'webview', 'socEditor.js');
const scriptSource = fs.readFileSync(scriptPath, 'utf8');
const { selectionForDiagnosticPath } = require(scriptPath);

function editorHtml() {
    return renderEditorHtml({
        cspSource: 'vscode-webview-resource:',
        asWebviewUri(uri) {
            return { toString: () => `vscode-webview-resource:${uri.path}` };
        },
    }, {
        path: '/extension',
        with(change) {
            return { ...this, ...change };
        },
    }, 'TEST_NONCE');
}

function modelFixture(overrides = {}) {
    return {
        documentVersion: 17,
        documentState: 'saved',
        readOnly: false,
        config: {
            project: { name: 'control_board', outputDir: 'generated/control_board' },
            cpu: { debug: false },
            memory: {
                ilb: { type: 'internal_ram', size: 16384 },
                dlb: { type: 'internal_ram', size: 16384 },
            },
            peripherals: [
                { type: 'apb_intc', name: 'intc0' },
                { type: 'apb_uart', name: 'uart0' },
            ],
            externalInterfaces: [],
            interrupt: { mode: 'controller', controller: 'intc0', sources: [] },
        },
        catalog: {
            modules: [
                { type: 'apb_intc', label: 'APB INTC', multiple: true, parameters: [] },
                { type: 'apb_uart', label: 'APB UART', multiple: true, parameters: [] },
            ],
            externalInterfaces: [],
        },
        diagnostics: [],
        selectedPath: ['project'],
        addressRows: [],
        interruptRows: [],
        portRows: [],
        dependencyRows: [],
        interruptOptions: {
            controllers: ['intc0'],
            directSources: ['intc0.irq', 'uart0.irq'],
            routedSources: ['uart0.irq'],
        },
        generation: {
            actionId: 3,
            phase: 'idle',
            message: 'No generation run in this editor session.',
        },
        ...overrides,
    };
}

function modelWithRoutes(count, interruptOverrides = {}) {
    const model = modelFixture();
    return {
        ...model,
        selectedPath: ['interrupt'],
        config: {
            ...model.config,
            interrupt: {
                mode: 'controller',
                controller: 'intc0',
                sources: Array.from({ length: count }, (_, index) => ({
                    source: `external.irq${index}`,
                    id: index,
                    trigger: 'high',
                })),
                ...interruptOverrides,
            },
        },
    };
}

function createHarness() {
    const posted = [];
    const dom = new JSDOM(editorHtml(), {
        runScripts: 'outside-only',
        url: 'https://webview.test/editor',
    });
    dom.window.acquireVsCodeApi = () => ({
        postMessage(message) {
            posted.push(JSON.parse(JSON.stringify(message)));
        },
    });
    dom.window.eval(scriptSource);
    const { document } = dom.window;
    return {
        dom,
        document,
        posted,
        deliver(message) {
            dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: message }));
        },
        click(selector) {
            const node = document.querySelector(selector);
            assert.ok(node, `Missing clickable element: ${selector}`);
            node.click();
        },
    };
}

function navButton(document, label) {
    return [...document.querySelectorAll('.nav-button')]
        .find((button) => button.querySelector('.nav-label')?.textContent === label);
}

function commandButton(document, command) {
    return document.querySelector(`[data-command="${command}"]`);
}

function dispatchKey(dom, node, key) {
    node.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key,
    }));
}

function runNavigationAndConcurrencyTests() {
    const harness = createHarness();
    const { document, posted } = harness;
    const model = modelFixture();
    harness.deliver({ type: 'state', value: model });

    assert.deepStrictEqual(
        [...document.querySelectorAll('.nav-label')].slice(0, 4).map((node) => node.textContent),
        ['Project', 'CPU', 'ILB memory', 'DLB memory'],
    );
    assert.strictEqual(document.querySelectorAll('.nav-badge').length, 0);
    assert.strictEqual(document.querySelector('.product-mark'), null);
    assert.strictEqual(commandButton(document, 'generate').textContent.trim(), 'Generate');
    assert.strictEqual(navButton(document, 'Project').getAttribute('aria-current'), 'true');
    assert.strictEqual(navButton(document, 'CPU').hasAttribute('aria-current'), false);
    assert.strictEqual(navButton(document, 'intc0').title, 'apb_intc');
    assert.strictEqual(navButton(document, 'intc0').textContent, 'intc0');

    harness.click('[data-command="generate"]');
    harness.click('[data-command="generate"]');
    assert.strictEqual(posted.filter((message) => message.type === 'generate').length, 1);
    harness.deliver({ type: 'state', value: modelFixture() });
    assert.strictEqual(commandButton(document, 'generate').disabled, true);
    harness.deliver({
        type: 'generationStatus',
        actionId: 4,
        action: 'generate',
        phase: 'generating',
        message: 'Running generator...',
    });
    harness.deliver({
        type: 'generationStatus',
        actionId: 2,
        action: 'generate',
        phase: 'error',
        message: 'Stale failure.',
    });
    assert.match(document.getElementById('generation-status').textContent, /Running generator/);
    navButton(document, 'CPU').click();
    assert.deepStrictEqual(posted.at(-1), { type: 'select', path: ['cpu'] });
    assert.strictEqual(navButton(document, 'CPU').disabled, false);
    assert.strictEqual(commandButton(document, 'generate').disabled, true);
    assert.deepStrictEqual(posted[0], { type: 'ready' });
    harness.deliver({
        type: 'generationStatus',
        actionId: 4,
        action: 'generate',
        phase: 'generated',
        message: 'Generation completed.',
    });
    assert.strictEqual(commandButton(document, 'generate').disabled, false);

    harness.dom.window.close();
}

function runCompactInterruptTests() {
    const harness = createHarness();
    const { document, posted } = harness;
    const model = modelWithRoutes(3);
    harness.deliver({ type: 'state', value: model });

    assert.strictEqual(document.querySelectorAll('.route-row').length, 3);
    const routeSource = document.querySelector('.route-row .route-source');
    assert.strictEqual(routeSource.getAttribute('list'), 'interrupt-source-options');
    assert.deepStrictEqual(
        [...document.querySelector('.interrupt-controller').options].map((option) => option.value),
        ['intc0'],
    );
    assert.deepStrictEqual(
        [...document.querySelectorAll('#interrupt-source-options option')]
            .map((option) => option.value),
        ['uart0.irq'],
    );
    assert.strictEqual(document.querySelector('.add-route').disabled, false);
    harness.click('.add-route');
    assert.strictEqual(posted.at(-1).value.at(-1).id, 3);

    harness.deliver({ type: 'state', value: modelWithRoutes(32) });
    assert.strictEqual(document.querySelector('.add-route').disabled, true);
    harness.click('[aria-label="Remove route 8"]');
    assert.strictEqual(posted.at(-1).type, 'setValue');
    assert.strictEqual(posted.at(-1).documentVersion, model.documentVersion);
    assert.strictEqual(posted.at(-1).value.length, 31);

    const directModel = modelWithRoutes(0, {
        mode: 'direct',
        source: 'uart0.irq',
    });
    harness.deliver({ type: 'state', value: directModel });
    assert.strictEqual(document.querySelector('.interrupt-direct-source').list.id,
        'interrupt-source-options');
    assert.deepStrictEqual(
        [...document.querySelectorAll('#interrupt-source-options option')]
            .map((option) => option.value),
        ['intc0.irq', 'uart0.irq'],
    );

    harness.dom.window.close();
}

function runSummaryKeyboardAndDiagnosticTests() {
    const harness = createHarness();
    const { dom, document, posted } = harness;
    const diagnosticModel = modelWithRoutes(3);
    const model = {
        ...diagnosticModel,
        diagnostics: [
            {
                severity: 'warning',
                code: 'SOC_IRQ_TRIGGER',
                message: 'Check the interrupt trigger.',
                path: ['interrupt', 'sources', 2, 'trigger'],
                line: 42,
                column: 15,
            },
            {
                severity: 'error',
                code: 'SOC_ADDRESS_OVERLAP',
                message: 'Address overlaps another peripheral.',
                path: ['peripherals', 1, 'baseAddress'],
                line: 18,
                column: 9,
            },
        ],
        addressRows: [{
            name: 'uart0',
            kind: 'peripheral',
            baseAddress: '0x10000000',
            endAddress: '0x10000fff',
            size: '4096 B',
        }],
        dependencyRows: [{ name: 'soc_top.v', kind: 'rtl', detail: 'Generated top' }],
    };
    harness.deliver({ type: 'state', value: model });

    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const [validation, address, , , dependency] = tabs;
    assert.ok(tabs.every((tab) => tab.getAttribute('aria-controls') === 'summary-content'));
    assert.strictEqual(document.getElementById('summary-content').getAttribute('aria-labelledby'),
        validation.id);

    dispatchKey(dom, validation, 'ArrowRight');
    assert.strictEqual(address.getAttribute('aria-selected'), 'true');
    assert.strictEqual(validation.tabIndex, -1);
    assert.strictEqual(address.tabIndex, 0);
    assert.strictEqual(document.activeElement, address);
    assert.match(document.getElementById('summary-content').textContent, /uart0/);

    dispatchKey(dom, address, 'ArrowLeft');
    assert.strictEqual(validation.getAttribute('aria-selected'), 'true');
    assert.strictEqual(document.activeElement, validation);
    assert.match(document.getElementById('summary-content').textContent, /SOC_IRQ_TRIGGER/);

    dispatchKey(dom, validation, 'End');
    assert.strictEqual(dependency.getAttribute('aria-selected'), 'true');
    assert.strictEqual(document.activeElement, dependency);
    assert.match(document.getElementById('summary-content').textContent, /soc_top\.v/);

    dispatchKey(dom, dependency, 'Home');
    assert.strictEqual(validation.getAttribute('aria-selected'), 'true');
    assert.strictEqual(document.activeElement, validation);

    dispatchKey(dom, validation, 'ArrowLeft');
    assert.strictEqual(dependency.getAttribute('aria-selected'), 'true');
    dispatchKey(dom, dependency, 'ArrowRight');
    assert.strictEqual(validation.getAttribute('aria-selected'), 'true');

    assert.deepStrictEqual(selectionForDiagnosticPath(
        ['interrupt', 'sources', 2, 'trigger'], model,
    ), ['interrupt']);
    assert.deepStrictEqual(selectionForDiagnosticPath(
        ['peripherals', 1, 'baseAddress'], model,
    ), ['peripherals', 1]);

    const diagnostic = document.querySelector('.diagnostic');
    assert.strictEqual(diagnostic.tagName, 'BUTTON');
    assert.match(diagnostic.getAttribute('aria-label'), /SOC_IRQ_TRIGGER.*line 42.*column 15/i);
    posted.length = 0;
    diagnostic.click();
    assert.deepStrictEqual(posted.at(-1), { type: 'select', path: ['interrupt'] });
    posted.length = 0;
    dispatchKey(dom, diagnostic, 'Enter');
    assert.deepStrictEqual(posted.at(-1), { type: 'select', path: ['interrupt'] });
    posted.length = 0;
    dispatchKey(dom, diagnostic, ' ');
    assert.deepStrictEqual(posted.at(-1), { type: 'select', path: ['interrupt'] });
    assert.strictEqual(validation.getAttribute('aria-selected'), 'true');

    harness.dom.window.close();
}

function runInteractionRestorationTests() {
    const harness = createHarness();
    const { dom, document, posted } = harness;
    const firstModel = modelFixture();
    harness.deliver({ type: 'state', value: firstModel });

    const navigationPane = document.querySelector('.navigation-pane');
    const propertyPane = document.querySelector('.property-pane');
    const summaryPane = document.querySelector('.summary-pane');
    let nameInput = document.querySelector('#property-form input[type="text"]');
    navigationPane.scrollTop = 91;
    propertyPane.scrollTop = 123;
    summaryPane.scrollTop = 57;
    nameInput.focus();
    nameInput.setSelectionRange(2, 7);

    const refreshedModel = {
        ...firstModel,
        documentVersion: 18,
        documentState: 'dirty',
        config: {
            ...firstModel.config,
            project: { ...firstModel.config.project, name: 'control_board_next' },
        },
        selectedPath: ['project'],
    };
    harness.deliver({ type: 'state', value: refreshedModel });
    nameInput = document.querySelector('#property-form input[type="text"]');
    assert.strictEqual(navigationPane.scrollTop, 91);
    assert.strictEqual(propertyPane.scrollTop, 123);
    assert.strictEqual(summaryPane.scrollTop, 57);
    assert.strictEqual(document.activeElement, nameInput);
    assert.strictEqual(nameInput.selectionStart, 2);
    assert.strictEqual(nameInput.selectionEnd, 7);

    posted.length = 0;
    nameInput.value = 'control_board_pending';
    nameInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.deepStrictEqual(posted.at(-1), {
        type: 'setValue',
        documentVersion: 18,
        path: ['project', 'name'],
        value: 'control_board_pending',
    });
    assert.ok([...document.querySelectorAll('#property-form [data-mutation-control]')]
        .every((control) => control.disabled));
    assert.strictEqual(navButton(document, 'CPU').disabled, false);
    assert.strictEqual(document.querySelector('[role="tab"]').disabled, false);
    assert.strictEqual(commandButton(document, 'generate').disabled, false);

    const settledModel = {
        ...refreshedModel,
        documentVersion: 19,
        config: {
            ...refreshedModel.config,
            project: { ...refreshedModel.config.project, name: 'control_board_pending' },
        },
    };
    harness.deliver({ type: 'state', value: settledModel });
    assert.ok([...document.querySelectorAll('#property-form [data-mutation-control]')]
        .every((control) => !control.disabled));

    navigationPane.scrollTop = 105;
    propertyPane.scrollTop = 144;
    summaryPane.scrollTop = 68;
    const changedSelection = {
        ...settledModel,
        documentVersion: 20,
        selectedPath: ['cpu'],
    };
    harness.deliver({ type: 'state', value: changedSelection });
    assert.strictEqual(navigationPane.scrollTop, 105);
    assert.strictEqual(summaryPane.scrollTop, 68);
    assert.strictEqual(propertyPane.scrollTop, 0);
    assert.notStrictEqual(document.activeElement, nameInput);

    harness.dom.window.close();
}

runNavigationAndConcurrencyTests();
runCompactInterruptTests();
runSummaryKeyboardAndDiagnosticTests();
runInteractionRestorationTests();
console.log('MERC32 SoC Webview interaction contracts passed.');
