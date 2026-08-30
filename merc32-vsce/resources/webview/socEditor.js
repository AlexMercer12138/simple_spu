(function () {
    'use strict';

    const vscode = acquireVsCodeApi();
    const shell = document.getElementById('editor-shell');
    const projectTitle = document.getElementById('project-title');
    const documentStatus = document.getElementById('document-status');
    const invalidBanner = document.getElementById('invalid-banner');
    const componentNav = document.getElementById('component-nav');
    const propertyTitle = document.getElementById('property-title');
    const propertyForm = document.getElementById('property-form');
    const summaryContent = document.getElementById('summary-content');
    const addressMap = document.getElementById('address-map');
    const generationStatus = document.getElementById('generation-status');

    let model;
    let activeSummary = 'validation';

    document.querySelectorAll('[data-command]').forEach((button) => {
        button.addEventListener('click', () => {
            const type = button.dataset.command;
            if (type === 'autoAssign' || type === 'validate' || type === 'generate'
                || type === 'reopenAsText') {
                vscode.postMessage({ type });
            }
        });
    });

    document.querySelectorAll('[data-summary]').forEach((button) => {
        button.addEventListener('click', () => {
            activeSummary = button.dataset.summary;
            renderSummary();
        });
    });

    window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || typeof message !== 'object') return;
        if (message.type === 'state') {
            model = message.value;
            render();
        } else if (message.type === 'generationStatus') {
            renderGeneration({ phase: message.phase, message: message.message });
        }
    });

    function render() {
        const hasConfig = Boolean(model && model.config && !model.readOnly);
        shell.setAttribute('aria-busy', 'false');
        shell.classList.toggle('is-read-only', !hasConfig);
        document.querySelectorAll('[data-requires-config]').forEach((control) => {
            control.disabled = !hasConfig;
        });

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
        renderGeneration(model.generation);
    }

    function renderNavigation() {
        componentNav.replaceChildren();
        if (!model.config) {
            componentNav.appendChild(emptyState('Configuration unavailable'));
            return;
        }

        const system = section('System');
        system.body.appendChild(navButton('Project', ['project'], 'PRJ'));
        system.body.appendChild(navButton('CPU', ['cpu'], 'CPU'));
        system.body.appendChild(navButton('ILB memory', ['memory', 'ilb'], 'ILB'));
        system.body.appendChild(navButton('DLB memory', ['memory', 'dlb'], 'DLB'));
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
        routing.body.appendChild(navButton('Interrupts', ['interrupt'], model.config.interrupt.mode.toUpperCase()));
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
            addField('Source', ['interrupt', 'source'], interrupt.source, { kind: 'text' });
        } else if (interrupt.mode === 'controller') {
            addField('Controller', ['interrupt', 'controller'], interrupt.controller, { kind: 'text' });
            interrupt.sources.forEach((source, index) => {
                const heading = element('div', 'route-heading');
                const remove = element('button', 'icon-button', '-');
                remove.type = 'button';
                remove.title = `Remove route ${index + 1}`;
                remove.setAttribute('aria-label', remove.title);
                remove.addEventListener('click', () => postSetValue(
                    ['interrupt', 'sources'],
                    interrupt.sources.filter((unused, sourceIndex) => sourceIndex !== index),
                ));
                heading.append(groupHeading(`Route ${index + 1}`), remove);
                propertyForm.appendChild(heading);
                addField('Source', ['interrupt', 'sources', index, 'source'], source.source, { kind: 'text' });
                addField('IRQ ID', ['interrupt', 'sources', index, 'id'], source.id, {
                    kind: 'number', minimum: 0, maximum: 31,
                });
                addField('Trigger', ['interrupt', 'sources', index, 'trigger'], source.trigger, {
                    kind: 'select',
                    options: ['high', 'low', 'rising', 'falling'].map((value) => ({ value, label: humanize(value) })),
                });
            });
            const addRoute = element('button', 'secondary-command');
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
            propertyForm.appendChild(addRoute);
        }
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
        control.disabled = Boolean(model.readOnly);
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
            detail.appendChild(reset);
        }
        row.append(label, detail);
        propertyForm.appendChild(row);
    }

    function renderSummary() {
        document.querySelectorAll('[data-summary]').forEach((button) => {
            const active = button.dataset.summary === activeSummary;
            button.setAttribute('aria-selected', String(active));
            button.tabIndex = active ? 0 : -1;
        });
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

    function section(title, count) {
        const root = element('section', 'nav-section');
        const heading = element('div', 'nav-heading');
        heading.appendChild(element('h2', '', title));
        if (count !== undefined) heading.appendChild(element('span', 'count', count));
        const body = element('div', 'nav-items');
        root.append(heading, body);
        return { root, body };
    }

    function navButton(label, path, badge) {
        const button = element('button', 'nav-button');
        button.type = 'button';
        button.classList.toggle('selected', samePath(path, model.selectedPath));
        button.append(element('span', 'nav-badge', badge), element('span', 'nav-label', label));
        button.addEventListener('click', () => vscode.postMessage({
            type: 'select', documentVersion: model.documentVersion, path,
        }));
        return button;
    }

    function instanceRow(name, type, path, collection, index) {
        const row = element('div', 'instance-row');
        const button = navButton(name, path, type.replace(/^apb_/, '').slice(0, 3).toUpperCase());
        const remove = element('button', 'icon-button', '-');
        remove.type = 'button';
        remove.title = `Remove ${name}`;
        remove.setAttribute('aria-label', `Remove ${name}`);
        remove.addEventListener('click', () => vscode.postMessage({
            type: 'removeInstance',
            documentVersion: model.documentVersion,
            collection,
            index,
        }));
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
        add.addEventListener('click', () => vscode.postMessage({
            type: 'addInstance',
            documentVersion: model.documentVersion,
            collection,
            itemType: select.value,
        }));
        row.append(select, add);
        return row;
    }

    function diagnosticRow(diagnostic) {
        const row = element('div', `diagnostic ${diagnostic.severity}`);
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
        vscode.postMessage({
            type: 'setValue',
            documentVersion: model.documentVersion,
            path,
            value,
        });
    }

    function postUnsetValue(path) {
        vscode.postMessage({
            type: 'unsetValue',
            documentVersion: model.documentVersion,
            path,
        });
    }

    function samePath(left, right) {
        return Array.isArray(right) && left.length === right.length
            && left.every((segment, index) => segment === right[index]);
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

    vscode.postMessage({ type: 'ready' });
}());
