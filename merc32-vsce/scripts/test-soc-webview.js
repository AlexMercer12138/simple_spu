const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const { renderEditorHtml } = require('../out/socEditorProvider');

const scriptPath = path.join(__dirname, '..', 'resources', 'webview', 'socEditor.js');
const scriptSource = fs.readFileSync(scriptPath, 'utf8');
const cssPath = path.join(__dirname, '..', 'resources', 'webview', 'socEditor.css');
const cssSource = fs.readFileSync(cssPath, 'utf8');
const { selectionForDiagnosticPath } = require(scriptPath);
const VISUAL_HARNESS_NONCE = 'VISUAL_HARNESS_NONCE';

function rule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's').exec(css);
    assert.ok(match, `Missing CSS rule: ${selector}`);
    return match[1];
}

function runResponsiveCssContractTests() {
    assert.match(rule(cssSource, '.editor-shell'), /height:\s*100vh/);
    assert.match(rule(cssSource, '.editor-shell'), /overflow:\s*hidden/);
    assert.match(rule(cssSource, '.editor-shell'), /minmax\(0,\s*1fr\)/);
    assert.doesNotMatch(cssSource, /\.editor-shell\s*\{[^}]*height:\s*auto/s);
    assert.match(rule(cssSource, '.bottom-band'), /height:\s*clamp\(/);
    assert.strictEqual(cssSource.includes('.nav-badge'), false);
    assert.ok(cssSource.includes('.route-row'));
}

function runVisualHarnessContractTests() {
    assert.strictEqual(typeof createVisualModel, 'function');
    const model = createVisualModel();
    assert.strictEqual(model.config.interrupt.mode, 'controller');
    assert.strictEqual(model.config.interrupt.sources.length, 32);
    assert.ok(model.diagnostics.length > 0);
    assert.ok(model.config.externalInterfaces.length > 0);
    assert.ok(model.addressRows.length > 0);
    assert.ok(model.interruptRows.length > 0);
    assert.ok(model.portRows.length > 0);
    assert.ok(model.dependencyRows.length > 0);
    assert.ok(model.dependencyRows.some((row) => row.name === 'flight_controller_plb_router.v'
        && row.kind === 'generated/rtl'),
    'visual fixture must show its generated PLB router dependency');
    const removedDependencyNames = [
        ['apb4', 'interconnect.v'].join('_'),
        ['sync', 'fifo.v'].join('_'),
    ];
    assert.ok(!model.dependencyRows.some((row) => removedDependencyNames.includes(row.name)),
    'visual fixture must not expose removed legacy helper dependencies');

    const html = visualEditorHtml();
    assert.ok(html.includes('href="/socEditor.css"'));
    assert.ok(html.includes('src="/socEditor.js"'));
    assert.ok(html.includes('nonce="VISUAL_HARNESS_NONCE" src="/harness.js"'));
    assert.ok(html.indexOf('src="/harness.js"') < html.indexOf('src="/socEditor.js"'));
    assert.ok(!/https?:\/\//i.test(html));

    const harness = visualHarnessScript(model);
    assert.doesNotThrow(() => new vm.Script(harness));
    assert.ok(harness.includes('acquireVsCodeApi'));
    assert.ok(harness.includes("message.type === 'select'"));
    assert.ok(harness.includes("message.type === 'generate'"));
    assert.ok(harness.includes("message.type === 'setValue'"));
}

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

function createVisualModel() {
    const routes = Array.from({ length: 32 }, (_, index) => ({
        source: index === 0 ? 'uart0.irq'
            : index === 1 ? 'timer0.irq'
                : `external.irq${index - 2}`,
        id: index,
        trigger: index % 4 === 0 ? 'rising' : index % 4 === 1 ? 'high'
            : index % 4 === 2 ? 'falling' : 'low',
    }));
    const model = modelFixture();
    return {
        ...model,
        documentVersion: 42,
        config: {
            project: { name: 'flight_controller', outputDir: 'generated/flight_controller' },
            cpu: { debug: true, jtagIdCode: '0x4d320001' },
            memory: {
                ilb: { type: 'internal_ram', size: 32768, initFile: 'software/boot.mem' },
                dlb: { type: 'internal_ram', size: 65536 },
            },
            peripherals: [
                { type: 'apb_intc', name: 'intc0', baseAddress: '0x10000000' },
                { type: 'apb_uart', name: 'uart0', baseAddress: '0x10001000' },
                { type: 'apb_gpio', name: 'gpio0', baseAddress: '0x10002000' },
                { type: 'apb_timer', name: 'timer0', baseAddress: '0x10003000' },
                { type: 'apb_spi', name: 'spi0', baseAddress: '0x10004000' },
            ],
            externalInterfaces: [{
                type: 'plb_window',
                name: 'sensor_bus',
                baseAddress: '0x20000000',
                windowSize: 65536,
                addressWidth: 16,
            }],
            interrupt: { mode: 'controller', controller: 'intc0', sources: routes },
        },
        catalog: {
            modules: [
                { type: 'apb_intc', label: 'APB interrupt controller', multiple: false, parameters: [] },
                { type: 'apb_uart', label: 'APB UART', multiple: true, parameters: [] },
                { type: 'apb_gpio', label: 'APB GPIO', multiple: true, parameters: [] },
                { type: 'apb_timer', label: 'APB timer', multiple: true, parameters: [] },
                { type: 'apb_spi', label: 'APB SPI', multiple: true, parameters: [] },
            ],
            externalInterfaces: [
                { type: 'plb_window', label: 'External PLB window', multiple: true, parameters: [] },
            ],
        },
        diagnostics: [
            {
                severity: 'warning',
                code: 'SOC_IRQ_TRIGGER',
                message: 'Confirm the edge trigger for external.irq6.',
                path: ['interrupt', 'sources', 8, 'trigger'],
                line: 94,
                column: 19,
            },
            {
                severity: 'warning',
                code: 'SOC_PORT_UNUSED',
                message: 'The optional trace output is not connected.',
                path: ['cpu'],
                line: 12,
                column: 5,
            },
        ],
        selectedPath: ['interrupt'],
        addressRows: [
            { name: 'intc0', kind: 'peripheral', baseAddress: '0x10000000', endAddress: '0x10000fff', size: '4 KiB' },
            { name: 'uart0', kind: 'peripheral', baseAddress: '0x10001000', endAddress: '0x10001fff', size: '4 KiB' },
            { name: 'gpio0', kind: 'peripheral', baseAddress: '0x10002000', endAddress: '0x10002fff', size: '4 KiB' },
            { name: 'timer0', kind: 'peripheral', baseAddress: '0x10003000', endAddress: '0x10003fff', size: '4 KiB' },
            { name: 'spi0', kind: 'peripheral', baseAddress: '0x10004000', endAddress: '0x10004fff', size: '4 KiB' },
            { name: 'sensor_bus', kind: 'external', baseAddress: '0x20000000', endAddress: '0x2000ffff', size: '64 KiB' },
        ],
        interruptRows: routes,
        portRows: [
            { name: 'clk_i', direction: 'input', width: 1 },
            { name: 'rst_ni', direction: 'input', width: 1 },
            { name: 'uart0_tx_o', direction: 'output', width: 1 },
            { name: 'gpio0_io', direction: 'inout', width: 16 },
            { name: 'sensor_plb', direction: 'interface', width: 32 },
        ],
        dependencyRows: [
            { name: 'flight_controller.v', kind: 'generated/rtl', detail: 'SoC top level' },
            { name: 'core.v', kind: 'asset/rtl', detail: 'MERC32 CPU core' },
            { name: 'flight_controller_plb_router.v', kind: 'generated/rtl', detail: 'PLB peripheral router' },
            { name: 'flight_controller.h', kind: 'generated/header', detail: 'Software address map' },
        ],
        interruptOptions: {
            controllers: ['intc0'],
            directSources: ['uart0.irq', 'timer0.irq', ...routes.slice(2).map((route) => route.source)],
            routedSources: ['uart0.irq', 'timer0.irq', ...routes.slice(2).map((route) => route.source)],
        },
        generation: {
            actionId: 7,
            phase: 'idle',
            message: 'Ready to generate the visual fixture.',
        },
    };
}

function visualEditorHtml() {
    const html = renderEditorHtml({
        cspSource: "'self'",
        asWebviewUri(uri) {
            return { toString: () => `/${path.basename(uri.path)}` };
        },
    }, {
        path: '/extension',
        with(change) {
            return { ...this, ...change };
        },
    }, VISUAL_HARNESS_NONCE);
    const controllerTag = `<script nonce="${VISUAL_HARNESS_NONCE}" src="/socEditor.js"></script>`;
    const harnessTag = `<script nonce="${VISUAL_HARNESS_NONCE}" src="/harness.js"></script>`;
    assert.ok(html.includes(controllerTag), 'production controller tag changed');
    return html.replace(controllerTag, `${harnessTag}\n    ${controllerTag}`);
}

function visualHarnessScript(initialModel) {
    return `(() => {
    'use strict';
    const state = ${JSON.stringify(initialModel)};
    let nextActionId = state.generation.actionId;
    const messages = [];
    const copy = (value) => JSON.parse(JSON.stringify(value));
    const dispatch = (data) => window.dispatchEvent(new MessageEvent('message', { data }));
    const sendState = () => dispatch({ type: 'state', value: copy(state) });
    const sendGeneration = (phase, message) => dispatch({
        type: 'generationStatus', actionId: nextActionId, action: 'generate', phase, message,
    });
    const parentAt = (path) => {
        let current = state.config;
        for (const segment of path.slice(0, -1)) current = current[segment];
        return [current, path[path.length - 1]];
    };
    const mutate = (message) => {
        if (message.type === 'setValue') {
            const [parent, key] = parentAt(message.path);
            parent[key] = copy(message.value);
        } else if (message.type === 'unsetValue') {
            const [parent, key] = parentAt(message.path);
            delete parent[key];
        } else if (message.type === 'removeInstance') {
            state.config[message.collection].splice(message.index, 1);
        } else if (message.type === 'addInstance') {
            const name = message.itemType + state.config[message.collection].length;
            state.config[message.collection].push(message.collection === 'peripherals'
                ? { type: message.itemType, name }
                : { type: message.itemType, name, windowSize: 4096, addressWidth: 12 });
        }
        state.documentVersion += 1;
        state.documentState = 'dirty';
        sendState();
    };
    const theme = {
        '--vscode-font-family': 'Segoe UI, sans-serif',
        '--vscode-editor-font-family': 'Cascadia Mono, Consolas, monospace',
        '--vscode-font-size': '13px',
        '--vscode-foreground': '#d4d4d4',
        '--vscode-descriptionForeground': '#a6a6a6',
        '--vscode-editor-background': '#1e1e1e',
        '--vscode-editorWidget-background': '#202020',
        '--vscode-editorGroupHeader-tabsBackground': '#252526',
        '--vscode-sideBar-background': '#181818',
        '--vscode-sideBar-foreground': '#cccccc',
        '--vscode-sideBarSectionHeader-border': '#333333',
        '--vscode-panel-background': '#181818',
        '--vscode-panel-border': '#3c3c3c',
        '--vscode-input-background': '#313131',
        '--vscode-input-foreground': '#f0f0f0',
        '--vscode-input-border': '#4a4a4a',
        '--vscode-focusBorder': '#1f9cf0',
        '--vscode-button-background': '#0e639c',
        '--vscode-button-foreground': '#ffffff',
        '--vscode-button-hoverBackground': '#1177bb',
        '--vscode-button-secondaryBackground': '#3a3d41',
        '--vscode-button-secondaryForeground': '#ffffff',
        '--vscode-button-secondaryHoverBackground': '#50545a',
        '--vscode-toolbar-hoverBackground': '#333333',
        '--vscode-icon-foreground': '#c5c5c5',
        '--vscode-badge-background': '#4d4d4d',
        '--vscode-badge-foreground': '#ffffff',
        '--vscode-list-activeSelectionBackground': '#094771',
        '--vscode-list-activeSelectionForeground': '#ffffff',
        '--vscode-tab-activeBackground': '#1e1e1e',
        '--vscode-tab-activeForeground': '#ffffff',
        '--vscode-tab-inactiveForeground': '#a0a0a0',
        '--vscode-charts-blue': '#3794ff',
        '--vscode-charts-green': '#89d185',
        '--vscode-testing-iconPassed': '#73c991',
        '--vscode-testing-iconFailed': '#f14c4c',
        '--vscode-errorForeground': '#f48771',
        '--vscode-editorWarning-foreground': '#cca700',
        '--vscode-statusBar-background': '#007acc',
        '--vscode-statusBar-foreground': '#ffffff',
        '--vscode-textBlockQuote-background': '#252526'
    };
    Object.entries(theme).forEach(([name, value]) => document.documentElement.style.setProperty(name, value));
    window.__socHarness = { state, messages };
    window.acquireVsCodeApi = () => ({
        postMessage(message) {
            messages.push(copy(message));
            if (message.type === 'ready') {
                sendState();
            } else if (message.type === 'select') {
                state.selectedPath = copy(message.path);
                sendState();
            } else if (message.type === 'generate') {
                nextActionId += 1;
                sendGeneration('generating', 'Resolving the 32-route interrupt map...');
                setTimeout(() => sendGeneration('generating', 'Staging RTL and software artifacts...'), 900);
                setTimeout(() => sendGeneration('generated', 'Visual fixture generation completed.'), 5000);
            } else if (message.type === 'setValue' || message.type === 'unsetValue'
                || message.type === 'addInstance' || message.type === 'removeInstance') {
                mutate(message);
            }
        }
    });
})();\n`;
}

function startVisualServer(port) {
    assert.ok(Number.isInteger(port) && port > 0 && port <= 65535,
        '--serve requires a port from 1 to 65535');
    const model = createVisualModel();
    const assets = new Map([
        ['/', ['text/html; charset=utf-8', visualEditorHtml()]],
        ['/socEditor.css', ['text/css; charset=utf-8', cssSource]],
        ['/socEditor.js', ['text/javascript; charset=utf-8', scriptSource]],
        ['/harness.js', ['text/javascript; charset=utf-8', visualHarnessScript(model)]],
    ]);
    const server = http.createServer((request, response) => {
        const pathname = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`).pathname;
        const asset = assets.get(pathname);
        if (!asset) {
            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('Not found');
            return;
        }
        response.writeHead(200, {
            'Content-Type': asset[0],
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
        });
        response.end(asset[1]);
    });
    server.listen(port, '127.0.0.1', () => {
        console.log(`MERC32 SoC visual harness: http://127.0.0.1:${port}`);
    });
    return server;
}

function createHarness(beforeStart) {
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
    if (beforeStart) beforeStart(dom.window.document);
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

function runInitialActionAvailabilityTests() {
    const rawDom = new JSDOM(editorHtml(), { runScripts: 'outside-only' });
    const rawDocument = rawDom.window.document;
    for (const command of ['autoAssign', 'validate', 'generate']) {
        assert.strictEqual(commandButton(rawDocument, command).disabled, true);
    }
    assert.strictEqual(commandButton(rawDocument, 'reopenAsText').disabled, false);
    rawDom.window.close();

    const harness = createHarness((document) => {
        document.querySelectorAll('[data-requires-config]').forEach((control) => {
            control.disabled = false;
        });
    });
    const { document, posted } = harness;
    for (const command of ['autoAssign', 'validate', 'generate']) {
        assert.strictEqual(commandButton(document, command).disabled, true);
    }
    commandButton(document, 'generate').click();
    assert.deepStrictEqual(posted, [{ type: 'ready' }]);

    const model = modelFixture();
    harness.deliver({ type: 'state', value: model });
    assert.strictEqual(commandButton(document, 'generate').disabled, false);
    commandButton(document, 'generate').click();
    assert.strictEqual(commandButton(document, 'generate').disabled, true);
    harness.deliver({
        type: 'state',
        value: { ...model, documentVersion: 18 },
    });
    assert.strictEqual(commandButton(document, 'generate').disabled, true);

    harness.dom.window.close();
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

function runStaleFullStateGenerationTests() {
    const harness = createHarness();
    const { document } = harness;
    const model = modelFixture();
    harness.deliver({ type: 'state', value: model });
    harness.deliver({
        type: 'generationStatus',
        actionId: 5,
        action: 'generate',
        phase: 'generating',
        message: 'Latest generator status.',
    });

    harness.deliver({
        type: 'state',
        value: {
            ...model,
            documentVersion: 18,
            config: {
                ...model.config,
                project: { ...model.config.project, name: 'refreshed_project' },
            },
            generation: {
                actionId: 4,
                action: 'generate',
                phase: 'error',
                message: 'Stale full-state failure.',
            },
        },
    });
    assert.strictEqual(document.getElementById('project-title').textContent, 'refreshed_project');
    assert.strictEqual(document.getElementById('generation-status').dataset.phase, 'generating');
    assert.match(document.getElementById('generation-status').textContent,
        /Latest generator status/);
    assert.doesNotMatch(document.getElementById('generation-status').textContent,
        /Stale full-state failure/);
    assert.strictEqual(commandButton(document, 'generate').disabled, true);

    harness.deliver({
        type: 'state',
        value: {
            ...model,
            documentVersion: 19,
            generation: {
                actionId: 5,
                action: 'generate',
                phase: 'generated',
                message: 'Latest generation completed.',
            },
        },
    });
    assert.strictEqual(document.getElementById('generation-status').dataset.phase, 'generated');
    assert.match(document.getElementById('generation-status').textContent,
        /Latest generation completed/);
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

function runNavigationMutationPendingTests() {
    const harness = createHarness();
    const { document, posted } = harness;
    const model = modelWithRoutes(1);
    harness.deliver({ type: 'state', value: model });

    posted.length = 0;
    let addPeripheral = document.querySelector('[aria-label="Add peripheral"]');
    let removeRoute = document.querySelector('[aria-label="Remove route 1"]');
    addPeripheral.click();
    assert.deepStrictEqual(posted.at(-1), {
        type: 'addInstance',
        documentVersion: 17,
        collection: 'peripherals',
        itemType: 'apb_intc',
    });
    assert.strictEqual(addPeripheral.disabled, true);
    assert.strictEqual(removeRoute.disabled, true);
    const afterAdd = posted.length;
    addPeripheral.click();
    removeRoute.click();
    assert.strictEqual(posted.length, afterAdd);

    harness.deliver({ type: 'state', value: model });
    posted.length = 0;
    const removeUart = document.querySelector('[aria-label="Remove uart0"]');
    removeRoute = document.querySelector('[aria-label="Remove route 1"]');
    addPeripheral = document.querySelector('[aria-label="Add peripheral"]');
    removeUart.click();
    assert.deepStrictEqual(posted.at(-1), {
        type: 'removeInstance',
        documentVersion: 17,
        collection: 'peripherals',
        index: 1,
    });
    assert.strictEqual(removeUart.disabled, true);
    assert.strictEqual(addPeripheral.disabled, true);
    assert.strictEqual(removeRoute.disabled, true);
    const afterRemove = posted.length;
    removeUart.click();
    removeRoute.click();
    assert.strictEqual(posted.length, afterRemove);

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

runResponsiveCssContractTests();
runVisualHarnessContractTests();
runInitialActionAvailabilityTests();
runNavigationAndConcurrencyTests();
runStaleFullStateGenerationTests();
runCompactInterruptTests();
runNavigationMutationPendingTests();
runSummaryKeyboardAndDiagnosticTests();
runInteractionRestorationTests();
console.log('MERC32 SoC Webview interaction contracts passed.');

const serveIndex = process.argv.indexOf('--serve');
if (serveIndex !== -1) {
    startVisualServer(Number(process.argv[serveIndex + 1]));
}
