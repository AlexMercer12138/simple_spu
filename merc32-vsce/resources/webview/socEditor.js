(function (root, factory) {
    'use strict';

    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        api.createSocEditorApp(root, root.acquireVsCodeApi());
    }
}(typeof globalThis === 'object' ? globalThis : this, function () {
    'use strict';

    function selectionForDiagnosticPath(path, model) {
        if (!model || !model.config || !Array.isArray(path)) return undefined;
        for (let length = path.length; length > 0; length -= 1) {
            const candidate = path.slice(0, length);
            if (isSelectablePath(candidate, model.config)) return candidate;
        }
        return undefined;
    }

    function isSelectablePath(path, config) {
        if (!path.every((segment) => typeof segment === 'string'
            ? segment.length > 0 && segment !== '__proto__' && segment !== 'prototype'
                && segment !== 'constructor' && !segment.includes('/') && !segment.includes('\\')
            : Number.isSafeInteger(segment) && segment >= 0)) {
            return false;
        }
        if (path.length === 1) {
            return path[0] === 'project' || path[0] === 'cpu' || path[0] === 'interrupt';
        }
        if (path.length !== 2) return false;
        if (path[0] === 'memory') return path[1] === 'ilb' || path[1] === 'dlb';
        if (path[0] === 'peripherals' && typeof path[1] === 'number') {
            return config.peripherals[path[1]] !== undefined;
        }
        return path[0] === 'externalInterfaces' && typeof path[1] === 'number'
            && config.externalInterfaces[path[1]] !== undefined;
    }

    function createSocEditorApp(root, vscode) {
    const document = root.document;
    const shell = document.getElementById('editor-shell');
    const projectTitle = document.getElementById('project-title');
    const documentStatus = document.getElementById('document-status');
    const invalidBanner = document.getElementById('invalid-banner');
    const componentNav = document.getElementById('component-nav');
    const navigationPane = document.querySelector('.navigation-pane');
    const propertyPane = document.querySelector('.property-pane');
    const propertyTitle = document.getElementById('property-title');
    const propertyForm = document.getElementById('property-form');
    const summaryPane = document.querySelector('.summary-pane');
    const summaryContent = document.getElementById('summary-content');
    const addressMap = document.getElementById('address-map');
    const generationStatus = document.getElementById('generation-status');

    let model;
    let activeSummary = 'validation';
    let pendingAction;
    let awaitingActionId = false;
    let pendingMutation = false;
    let latestActionId = -1;
    let latestGeneration;

    document.querySelectorAll('[data-command]').forEach((button) => {
        button.addEventListener('click', () => {
            const type = button.dataset.command;
            if (type === 'autoAssign' || type === 'validate' || type === 'generate'
                || type === 'reopenAsText') {
                if (type !== 'reopenAsText') {
                    pendingAction = type;
                    awaitingActionId = true;
                    renderActionControls();
                }
                vscode.postMessage({ type });
            }
        });
    });

    document.querySelectorAll('[data-summary]').forEach((button) => {
        button.id = `summary-tab-${button.dataset.summary}`;
        button.setAttribute('aria-controls', 'summary-content');
        button.addEventListener('click', () => {
            activateSummary(button.dataset.summary);
        });
        button.addEventListener('keydown', (event) => {
            const tabs = [...document.querySelectorAll('[data-summary]')];
            const index = tabs.indexOf(button);
            let nextIndex;
            if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
            else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
            else if (event.key === 'Home') nextIndex = 0;
            else if (event.key === 'End') nextIndex = tabs.length - 1;
            else return;
            event.preventDefault();
            const target = tabs[nextIndex];
            activateSummary(target.dataset.summary);
            target.focus();
        });
    });

    root.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || typeof message !== 'object') return;
        if (message.type === 'state') {
            const interactionState = captureInteractionState();
            model = message.value;
            pendingMutation = false;
            acceptGeneration(model.generation);
            render(interactionState);
        } else if (message.type === 'generationStatus') {
            acceptGeneration(message);
        }
    });

    function render(interactionState) {
        const hasConfig = Boolean(model && model.config && !model.readOnly);
        shell.setAttribute('aria-busy', 'false');
        shell.classList.toggle('is-read-only', !hasConfig);
        renderActionControls();

        if (!hasConfig) {
            projectTitle.textContent = 'MERC32 SoC';
            documentStatus.textContent = `JSON error - version ${model.documentVersion}`;
            invalidBanner.hidden = false;
            const first = model.diagnostics[0];
            invalidBanner.textContent = first
                ? `${first.message} (line ${first.line}, column ${first.column})`
                : 'The configuration cannot be parsed.';
        } else {
            projectTitle.textContent = model.config.project.name;
            documentStatus.textContent = `Document version ${model.documentVersion}`;
            invalidBanner.hidden = true;
            invalidBanner.textContent = '';
        }

        renderNavigation();
        renderProperties();
        renderSummary();
        renderAddressMap();
        renderGeneration(latestGeneration);
        restoreInteractionState(interactionState);
    }

    function renderNavigation() {
        componentNav.replaceChildren();
        if (!model.config) {
            componentNav.appendChild(emptyState('Configuration unavailable'));
            return;
        }

        const system = section('System');
        system.body.appendChild(navButton('Project', ['project']));
        system.body.appendChild(navButton('CPU', ['cpu']));
        system.body.appendChild(navButton('ILB memory', ['memory', 'ilb']));
        system.body.appendChild(navButton('DLB memory', ['memory', 'dlb']));
        componentNav.appendChild(system.root);

        const peripherals = section('APB peripherals', String(model.config.peripherals.length));
        model.config.peripherals.forEach((item, index) => {
            peripherals.body.appendChild(instanceRow(
                item.name,
                item.type,
                ['peripherals', index],
                'peripherals',
                index,
            ));
        });
        peripherals.body.appendChild(addRow('peripherals', model.catalog.modules));
        componentNav.appendChild(peripherals.root);

        const endpoints = section('External endpoints', String(model.config.externalInterfaces.length));
        model.config.externalInterfaces.forEach((item, index) => {
            endpoints.body.appendChild(instanceRow(
                item.name,
                item.type,
                ['externalInterfaces', index],
                'externalInterfaces',
                index,
            ));
        });
        endpoints.body.appendChild(addRow('externalInterfaces', model.catalog.externalInterfaces));
        componentNav.appendChild(endpoints.root);

        const routing = section('Interrupt routing');
        routing.body.appendChild(navButton('Interrupts', ['interrupt']));
        componentNav.appendChild(routing.root);
    }

    function renderProperties() {
        propertyForm.replaceChildren();
        if (!model.config) {
            propertyTitle.textContent = 'Read-only JSON';
            const fragment = document.createDocumentFragment();
            model.diagnostics.forEach((diagnostic) => {
                fragment.appendChild(diagnosticRow(diagnostic));
            });
            propertyForm.appendChild(fragment);
            return;
        }

        const selected = model.selectedPath || ['cpu'];
        const root = selected[0];
        if (root === 'project') {
            propertyTitle.textContent = 'Project';
            addField('Project name', ['project', 'name'], model.config.project.name, { kind: 'text' });
            addField('Output directory', ['project', 'outputDir'], model.config.project.outputDir, { kind: 'text' });
        } else if (root === 'cpu') {
            propertyTitle.textContent = 'CPU';
            addField('Debug port', ['cpu', 'debug'], Boolean(model.config.cpu.debug), {
                kind: 'boolean', optional: true,
            });
            addField('JTAG ID code', ['cpu', 'jtagIdCode'], model.config.cpu.jtagIdCode || '', {
                kind: 'text', optional: true, placeholder: '0x4d320001 (default)',
            });
        } else if (root === 'memory') {
            renderMemory(selected[1]);
        } else if (root === 'peripherals') {
            renderPeripheral(selected[1]);
        } else if (root === 'externalInterfaces') {
            renderExternal(selected[1]);
        } else if (root === 'interrupt') {
            renderInterrupt();
        }
    }

    function renderMemory(slot) {
        const memory = model.config.memory[slot];
        propertyTitle.textContent = `${slot.toUpperCase()} memory`;
        addField('Implementation', ['memory', slot, 'type'], memory.type, {
            kind: 'select',
            options: [
                { value: 'internal_ram', label: 'Internal RAM' },
                { value: 'external_local_bus', label: 'External local bus' },
            ],
        });
        addField('Capacity', ['memory', slot, 'size'], memory.size, { kind: valueKind(memory.size) });
        if (memory.type === 'internal_ram') {
            addField('Initialization file', ['memory', slot, 'initFile'], memory.initFile || '', {
                kind: 'text', optional: true,
            });
        }
    }

    function renderPeripheral(index) {
        const peripheral = model.config.peripherals[index];
        if (!peripheral) return;
        const descriptor = model.catalog.modules.find((item) => item.type === peripheral.type);
        propertyTitle.textContent = peripheral.name;
        addField('Module type', ['peripherals', index, 'type'], peripheral.type, {
            kind: 'select',
            options: model.catalog.modules.map((item) => ({ value: item.type, label: item.label })),
        });
        addField('Instance name', ['peripherals', index, 'name'], peripheral.name, { kind: 'text' });
        addField('Base address', ['peripherals', index, 'baseAddress'], peripheral.baseAddress || '', {
            kind: 'text', optional: true,
        });
        if (descriptor && descriptor.parameters.length) {
            propertyForm.appendChild(groupHeading('Module parameters'));
            descriptor.parameters.forEach((parameter) => {
                const current = peripheral.parameters && Object.prototype.hasOwnProperty.call(
                    peripheral.parameters, parameter.name,
                ) ? peripheral.parameters[parameter.name] : parameter.default;
                addField(humanize(parameter.name), ['peripherals', index, 'parameters', parameter.name], current, {
                    kind: parameter.type === 'boolean' ? 'boolean'
                        : parameter.type === 'enum' ? 'select'
                            : parameter.type === 'string' ? 'text' : 'number',
                    minimum: parameter.minimum,
                    maximum: parameter.maximum,
                    optional: true,
                    options: parameter.values && parameter.values.map((value) => ({
                        value,
                        label: String(value),
                    })),
                });
            });
        }
    }

    function renderExternal(index) {
        const endpoint = model.config.externalInterfaces[index];
        if (!endpoint) return;
        propertyTitle.textContent = endpoint.name;
        addField('Protocol', ['externalInterfaces', index, 'type'], endpoint.type, {
            kind: 'select',
            options: model.catalog.externalInterfaces.map((item) => ({ value: item.type, label: item.label })),
        });
        addField('Instance name', ['externalInterfaces', index, 'name'], endpoint.name, { kind: 'text' });
        addField('Base address', ['externalInterfaces', index, 'baseAddress'], endpoint.baseAddress || '', {
            kind: 'text', optional: true,
        });
        addField('Window size', ['externalInterfaces', index, 'windowSize'], endpoint.windowSize, {
            kind: valueKind(endpoint.windowSize),
        });
        addField('Address width', ['externalInterfaces', index, 'addressWidth'], endpoint.addressWidth, {
            kind: 'number', minimum: 1, maximum: 32,
        });
    }

    function renderInterrupt() {
        const interrupt = model.config.interrupt;
        propertyTitle.textContent = 'Interrupt routing';
        addField('Mode', ['interrupt', 'mode'], interrupt.mode, {
            kind: 'select',
            options: [
                { value: 'none', label: 'None' },
                { value: 'direct', label: 'Direct' },
                { value: 'controller', label: 'Controller' },
            ],
        });
        if (interrupt.mode === 'direct') {
            appendInterruptSourceOptions(model.interruptOptions.directSources);
            addField('Source', ['interrupt', 'source'], interrupt.source, {
                kind: 'text',
                className: 'interrupt-direct-source',
                list: 'interrupt-source-options',
            });
        } else if (interrupt.mode === 'controller') {
            addField('Controller', ['interrupt', 'controller'], interrupt.controller, {
                kind: 'select',
                className: 'interrupt-controller',
                options: model.interruptOptions.controllers.map((value) => ({ value, label: value })),
            });
            appendInterruptSourceOptions(model.interruptOptions.routedSources);
            const editor = element('div', 'route-editor');
            const header = element('div', 'route-header');
            header.append(
                element('span', '', 'Source'),
                element('span', '', 'IRQ ID'),
                element('span', '', 'Trigger'),
                element('span', 'visually-hidden', 'Actions'),
            );
            editor.appendChild(header);
            interrupt.sources.forEach((source, index) => {
                const route = element('div', 'route-row');
                route.setAttribute('role', 'group');
                route.setAttribute('aria-label', `Route ${index + 1}`);
                const sourceControl = document.createElement('input');
                sourceControl.type = 'text';
                sourceControl.className = 'route-source';
                sourceControl.value = source.source;
                sourceControl.setAttribute('list', 'interrupt-source-options');
                sourceControl.setAttribute('aria-label', `Route ${index + 1} source`);
                setFieldPath(sourceControl, ['interrupt', 'sources', index, 'source']);
                sourceControl.addEventListener('change', () => postSetValue(
                    ['interrupt', 'sources', index, 'source'], sourceControl.value,
                ));

                const idControl = document.createElement('input');
                idControl.type = 'number';
                idControl.className = 'route-id';
                idControl.value = String(source.id);
                idControl.min = '0';
                idControl.max = '31';
                idControl.step = '1';
                idControl.setAttribute('aria-label', `Route ${index + 1} IRQ ID`);
                setFieldPath(idControl, ['interrupt', 'sources', index, 'id']);
                idControl.addEventListener('change', () => {
                    const value = Number(idControl.value);
                    if (Number.isFinite(value)) {
                        postSetValue(['interrupt', 'sources', index, 'id'], value);
                    }
                });

                const triggerControl = document.createElement('select');
                triggerControl.className = 'route-trigger';
                triggerControl.setAttribute('aria-label', `Route ${index + 1} trigger`);
                setFieldPath(triggerControl, ['interrupt', 'sources', index, 'trigger']);
                ['high', 'low', 'rising', 'falling'].forEach((value) => {
                    const option = document.createElement('option');
                    option.value = value;
                    option.textContent = humanize(value);
                    option.selected = value === source.trigger;
                    triggerControl.appendChild(option);
                });
                triggerControl.addEventListener('change', () => postSetValue(
                    ['interrupt', 'sources', index, 'trigger'], triggerControl.value,
                ));

                const remove = element('button', 'icon-button', '-');
                remove.type = 'button';
                remove.title = `Remove route ${index + 1}`;
                remove.setAttribute('aria-label', remove.title);
                remove.addEventListener('click', () => postSetValue(
                    ['interrupt', 'sources'],
                    interrupt.sources.filter((unused, sourceIndex) => sourceIndex !== index),
                ));
                [sourceControl, idControl, triggerControl, remove].forEach(markMutationControl);
                route.append(sourceControl, idControl, triggerControl, remove);
                editor.appendChild(route);
            });
            const addRoute = element('button', 'secondary-command add-route');
            addRoute.type = 'button';
            addRoute.textContent = '+ Add route';
            addRoute.title = 'Add interrupt route';
            addRoute.addEventListener('click', () => {
                const usedIds = new Set(interrupt.sources.map((source) => source.id));
                let id = 0;
                while (usedIds.has(id)) id += 1;
                postSetValue(['interrupt', 'sources'], [
                    ...interrupt.sources,
                    { source: `external.irq${id}`, id, trigger: 'high' },
                ]);
            });
            markMutationControl(addRoute);
            addRoute.disabled = model.readOnly || interrupt.sources.length >= 32 || pendingMutation;
            editor.appendChild(addRoute);
            propertyForm.appendChild(editor);
        }
    }

    function appendInterruptSourceOptions(sources) {
        const list = document.createElement('datalist');
        list.id = 'interrupt-source-options';
        sources.forEach((value) => {
            const option = document.createElement('option');
            option.value = value;
            list.appendChild(option);
        });
        propertyForm.appendChild(list);
    }

    function addField(labelText, path, value, options) {
        const row = element('label', 'field-row');
        const label = element('span', 'field-label', labelText);
        const detail = element('span', 'field-detail');
        let control;
        if (options.kind === 'boolean') {
            control = document.createElement('input');
            control.type = 'checkbox';
            control.checked = Boolean(value);
            control.addEventListener('change', () => postSetValue(path, control.checked));
        } else if (options.kind === 'select') {
            control = document.createElement('select');
            (options.options || []).forEach((optionValue) => {
                const option = document.createElement('option');
                option.value = String(optionValue.value);
                option.textContent = optionValue.label;
                option.selected = optionValue.value === value;
                control.appendChild(option);
            });
            control.addEventListener('change', () => {
                const selected = (options.options || []).find((item) => String(item.value) === control.value);
                if (selected) postSetValue(path, selected.value);
            });
        } else {
            control = document.createElement('input');
            control.type = options.kind === 'number' ? 'number' : 'text';
            control.value = value === undefined ? '' : String(value);
            if (options.placeholder !== undefined) control.placeholder = options.placeholder;
            if (options.minimum !== undefined) control.min = String(options.minimum);
            if (options.maximum !== undefined) control.max = String(options.maximum);
            if (options.kind === 'number') control.step = '1';
            control.addEventListener('change', () => {
                if (control.value === '') {
                    if (options.optional) postUnsetValue(path);
                    return;
                }
                const next = options.kind === 'number' ? Number(control.value) : control.value;
                if (options.kind !== 'number' || Number.isFinite(next)) postSetValue(path, next);
            });
        }
        if (options.className) control.className = options.className;
        if (options.list) control.setAttribute('list', options.list);
        setFieldPath(control, path);
        markMutationControl(control);
        detail.appendChild(control);
        if (options.optional) {
            const reset = element('button', 'field-reset', '-');
            reset.type = 'button';
            reset.title = `Clear ${labelText}`;
            reset.setAttribute('aria-label', reset.title);
            reset.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                postUnsetValue(path);
            });
            markMutationControl(reset);
            detail.appendChild(reset);
        }
        row.append(label, detail);
        propertyForm.appendChild(row);
    }

    function renderSummary() {
        let activeTab;
        document.querySelectorAll('[data-summary]').forEach((button) => {
            const active = button.dataset.summary === activeSummary;
            button.setAttribute('aria-selected', String(active));
            button.tabIndex = active ? 0 : -1;
            if (active) activeTab = button;
        });
        if (activeTab) summaryContent.setAttribute('aria-labelledby', activeTab.id);
        summaryContent.replaceChildren();
        if (!model) return;
        const renderers = {
            validation: () => renderValidationSummary(),
            address: () => renderRows(model.addressRows, [
                ['Endpoint', 'name'], ['Base', 'baseAddress'], ['End', 'endAddress'], ['Size', 'size'],
            ]),
            irq: () => renderRows(model.interruptRows, [
                ['Source', 'source'], ['ID', 'id'], ['Trigger', 'trigger'],
            ]),
            port: () => renderRows(model.portRows, [
                ['Port', 'name'], ['Direction', 'direction'], ['Width', 'width'],
            ]),
            dependency: () => renderRows(model.dependencyRows, [
                ['Dependency', 'name'], ['Kind', 'kind'], ['Detail', 'detail'],
            ]),
        };
        renderers[activeSummary]();
    }

    function activateSummary(summary) {
        activeSummary = summary;
        renderSummary();
    }

    function renderValidationSummary() {
        if (!model.diagnostics.length) {
            summaryContent.appendChild(emptyState('No diagnostics'));
            return;
        }
        model.diagnostics.forEach((diagnostic) => summaryContent.appendChild(diagnosticRow(diagnostic)));
    }

    function renderRows(rows, columns) {
        if (!rows.length) {
            summaryContent.appendChild(emptyState('No resolved entries'));
            return;
        }
        const table = element('table', 'summary-table');
        const head = document.createElement('thead');
        const headRow = document.createElement('tr');
        columns.forEach(([label]) => headRow.appendChild(element('th', '', label)));
        head.appendChild(headRow);
        const body = document.createElement('tbody');
        rows.forEach((row) => {
            const tableRow = document.createElement('tr');
            columns.forEach(([, key]) => tableRow.appendChild(element(
                'td', '', row[key] === undefined ? '-' : String(row[key]),
            )));
            body.appendChild(tableRow);
        });
        table.append(head, body);
        summaryContent.appendChild(table);
    }

    function renderAddressMap() {
        addressMap.replaceChildren();
        if (!model.addressRows.length) {
            addressMap.appendChild(emptyState('No resolved PLB endpoints'));
            return;
        }
        model.addressRows.forEach((row) => {
            const item = element('div', `address-item ${row.kind}`);
            item.append(
                element('strong', '', row.name),
                element('span', '', `${row.baseAddress} - ${row.endAddress}`),
            );
            addressMap.appendChild(item);
        });
    }

    function renderGeneration(generation) {
        generationStatus.replaceChildren();
        generationStatus.dataset.phase = generation.phase;
        generationStatus.append(
            element('span', 'status-indicator', generation.phase.slice(0, 1).toUpperCase()),
            element('span', '', generation.message),
        );
    }

    function acceptGeneration(generation) {
        if (!generation || generation.actionId < latestActionId) return;
        latestGeneration = generation;
        const isPendingActionProgress = awaitingActionId && generation.actionId === latestActionId;
        if (!isPendingActionProgress) {
            latestActionId = generation.actionId;
            awaitingActionId = false;
            pendingAction = isBusyPhase(generation.phase) ? generation.action : undefined;
        }
        renderGeneration(generation);
        renderActionControls();
    }

    function renderActionControls() {
        const hasConfig = Boolean(model && model.config && !model.readOnly);
        document.querySelectorAll('[data-requires-config]').forEach((control) => {
            control.disabled = !hasConfig || Boolean(pendingAction);
        });
    }

    function isBusyPhase(phase) {
        return phase === 'working' || phase === 'validating' || phase === 'generating';
    }

    function section(title, count) {
        const root = element('section', 'nav-section');
        const heading = element('div', 'nav-heading');
        heading.appendChild(element('h2', '', title));
        if (count !== undefined) heading.appendChild(element('span', 'count', count));
        const body = element('div', 'nav-items');
        root.append(heading, body);
        return { root, body };
    }

    function navButton(label, path) {
        const button = element('button', 'nav-button');
        button.type = 'button';
        const selected = samePath(path, model.selectedPath);
        button.classList.toggle('selected', selected);
        if (selected) button.setAttribute('aria-current', 'true');
        button.appendChild(element('span', 'nav-label', label));
        button.addEventListener('click', () => vscode.postMessage({
            type: 'select', path,
        }));
        return button;
    }

    function instanceRow(name, type, path, collection, index) {
        const row = element('div', 'instance-row');
        const button = navButton(name, path);
        button.title = type;
        const remove = element('button', 'icon-button', '-');
        remove.type = 'button';
        remove.title = `Remove ${name}`;
        remove.setAttribute('aria-label', `Remove ${name}`);
        remove.addEventListener('click', () => postMutation({
            type: 'removeInstance',
            documentVersion: model.documentVersion,
            collection,
            index,
        }));
        markMutationControl(remove);
        row.append(button, remove);
        return row;
    }

    function addRow(collection, catalogItems) {
        const row = element('div', 'add-row');
        const select = document.createElement('select');
        select.setAttribute('aria-label', collection === 'peripherals' ? 'Peripheral type' : 'Endpoint type');
        catalogItems.forEach((item) => {
            const option = document.createElement('option');
            option.value = item.type;
            option.textContent = item.label;
            select.appendChild(option);
        });
        const add = element('button', 'icon-button', '+');
        add.type = 'button';
        add.title = collection === 'peripherals' ? 'Add peripheral' : 'Add external endpoint';
        add.setAttribute('aria-label', add.title);
        add.addEventListener('click', () => postMutation({
            type: 'addInstance',
            documentVersion: model.documentVersion,
            collection,
            itemType: select.value,
        }));
        markMutationControl(add);
        row.append(select, add);
        return row;
    }

    function diagnosticRow(diagnostic) {
        const row = element('button', `diagnostic ${diagnostic.severity}`);
        row.type = 'button';
        row.setAttribute('aria-label', `${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}; `
            + `line ${diagnostic.line}, column ${diagnostic.column}`);
        const activate = () => {
            const path = selectionForDiagnosticPath(diagnostic.path, model);
            if (path) vscode.postMessage({ type: 'select', path });
        };
        row.addEventListener('click', activate);
        row.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            activate();
        });
        row.append(
            element('span', 'diagnostic-code', diagnostic.code),
            element('span', 'diagnostic-message', diagnostic.message),
            element('span', 'diagnostic-location', `${diagnostic.line}:${diagnostic.column}`),
        );
        return row;
    }

    function groupHeading(text) {
        return element('h3', 'group-heading', text);
    }

    function emptyState(text) {
        return element('p', 'empty-state', text);
    }

    function postSetValue(path, value) {
        postMutation({
            type: 'setValue',
            documentVersion: model.documentVersion,
            path,
            value,
        });
    }

    function postUnsetValue(path) {
        postMutation({
            type: 'unsetValue',
            documentVersion: model.documentVersion,
            path,
        });
    }

    function postMutation(message) {
        beginMutation();
        vscode.postMessage(message);
    }

    function beginMutation() {
        pendingMutation = true;
        document.querySelectorAll('[data-mutation-control]').forEach((control) => {
            control.disabled = true;
        });
    }

    function captureInteractionState() {
        const focused = document.activeElement;
        let focusedPath;
        if (focused && focused.dataset && focused.dataset.fieldPath) {
            try {
                focusedPath = JSON.parse(focused.dataset.fieldPath);
            } catch {
                focusedPath = undefined;
            }
        }
        return {
            navigationScrollTop: navigationPane.scrollTop,
            propertyScrollTop: propertyPane.scrollTop,
            summaryScrollTop: summaryPane.scrollTop,
            focusedPath,
            selectionStart: focused && typeof focused.selectionStart === 'number'
                ? focused.selectionStart : undefined,
            selectionEnd: focused && typeof focused.selectionEnd === 'number'
                ? focused.selectionEnd : undefined,
            selectedPath: model && model.selectedPath,
        };
    }

    function restoreInteractionState(state) {
        navigationPane.scrollTop = state.navigationScrollTop;
        summaryPane.scrollTop = state.summaryScrollTop;
        if (!sameOptionalPath(state.selectedPath, model && model.selectedPath)) {
            propertyPane.scrollTop = 0;
            return;
        }
        if (state.focusedPath) {
            const focused = [...propertyForm.querySelectorAll('[data-field-path]')]
                .find((control) => samePath(state.focusedPath, fieldPath(control)));
            if (focused) {
                focused.focus({ preventScroll: true });
                if (typeof focused.setSelectionRange === 'function'
                    && state.selectionStart !== undefined && state.selectionEnd !== undefined) {
                    try {
                        focused.setSelectionRange(state.selectionStart, state.selectionEnd);
                    } catch {
                        // Select and numeric controls do not expose text selections.
                    }
                }
            }
        }
        propertyPane.scrollTop = state.propertyScrollTop;
    }

    function fieldPath(control) {
        try {
            return JSON.parse(control.dataset.fieldPath);
        } catch {
            return undefined;
        }
    }

    function setFieldPath(control, path) {
        control.dataset.fieldPath = JSON.stringify(path);
    }

    function markMutationControl(control) {
        control.dataset.mutationControl = '';
        control.disabled = Boolean(model.readOnly || pendingMutation);
    }

    function samePath(left, right) {
        return Array.isArray(left) && Array.isArray(right) && left.length === right.length
            && left.every((segment, index) => segment === right[index]);
    }

    function sameOptionalPath(left, right) {
        return left === undefined && right === undefined || samePath(left, right);
    }

    function valueKind(value) {
        return typeof value === 'number' ? 'number' : 'text';
    }

    function humanize(value) {
        return String(value).split('_').map((part) =>
            part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase()).join(' ');
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    renderActionControls();
    vscode.postMessage({ type: 'ready' });
    return {};
    }

    return { createSocEditorApp, selectionForDiagnosticPath };
}));
