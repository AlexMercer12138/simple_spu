const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { JSDOM } = require('jsdom');

const extensionRoot = path.join(__dirname, '..');
const screenshotRoot = path.join(extensionRoot, '.test-results', 'soc-webview-geometry');
const viewports = [
    { name: 'wide', width: 1440, height: 900 },
    { name: 'medium', width: 1000, height: 760 },
    { name: 'narrow', width: 640, height: 720 },
    { name: 'short', width: 1100, height: 520 },
];
const scenarios = ['short', 'ports', 'routes'];

function browserPath() {
    const candidates = process.platform === 'win32' ? [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ] : process.platform === 'darwin' ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ] : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
    const selected = [process.env.MERC32_BROWSER_PATH, ...candidates]
        .find((candidate) => candidate && fs.existsSync(candidate));
    assert.ok(selected, 'No Chromium-family browser found; set MERC32_BROWSER_PATH');
    return selected;
}

function startServer() {
    const server = spawn(process.execPath, ['scripts/test-soc-webview.js', '--serve', '0'], {
        cwd: extensionRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    let output = '';
    let errors = '';
    server.stdout.setEncoding('utf8');
    server.stderr.setEncoding('utf8');
    server.stdout.on('data', (chunk) => { output += chunk; });
    server.stderr.on('data', (chunk) => { errors += chunk; });
    const ready = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(
            `Timed out waiting for visual harness.\n${output}\n${errors}`,
        )), 15000);
        const inspect = () => {
            const match = /MERC32 SoC visual harness: (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
            if (!match) return;
            clearTimeout(timeout);
            resolve(match[1]);
        };
        server.stdout.on('data', inspect);
        server.once('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        server.once('exit', (code) => {
            if (code === null || /MERC32 SoC visual harness:/.test(output)) return;
            clearTimeout(timeout);
            reject(new Error(`Visual harness exited with ${code}.\n${output}\n${errors}`));
        });
    });
    return { server, ready, diagnostics: () => `${output}\n${errors}` };
}

function stopServer(server) {
    if (server.exitCode !== null || server.signalCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            if (process.platform === 'win32') {
                const terminator = spawn('taskkill', ['/pid', String(server.pid), '/t', '/f'], {
                    stdio: 'ignore',
                    windowsHide: true,
                });
                terminator.once('exit', resolve);
                terminator.once('error', resolve);
            } else {
                server.kill('SIGKILL');
                resolve();
            }
        }, 3000);
        server.once('exit', () => {
            clearTimeout(timeout);
            resolve();
        });
        server.kill();
    });
}

function launchBrowser(executable, serverUrl, viewport, scenario) {
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-soc-geometry-'));
    const screenshotFile = path.join(screenshotRoot, `${viewport.name}-${scenario}.png`);
    const args = [
        '--headless=new', '--disable-gpu', '--disable-background-networking',
        '--disable-component-update', '--disable-sync', '--no-first-run',
        '--no-default-browser-check', '--force-device-scale-factor=1',
        '--virtual-time-budget=3000',
        `--user-data-dir=${profileDir}`, `--window-size=${viewport.width},${viewport.height}`,
        `--screenshot=${screenshotFile}`, '--dump-dom',
        `${serverUrl}/?scenario=${scenario}&geometry=1`,
    ];
    try {
        const browser = spawnSync(executable, args, {
            cwd: extensionRoot,
            encoding: 'utf8',
            maxBuffer: 20 * 1024 * 1024,
            windowsHide: true,
        });
        const output = browser.stdout || '';
        const errors = browser.stderr || '';
        assert.ifError(browser.error);
        assert.strictEqual(browser.status, 0, `Browser exited with ${browser.status}.\n${errors}`);
        assert.ok(fs.existsSync(screenshotFile), `Missing screenshot: ${screenshotFile}`);
        const dom = new JSDOM(output);
        const geometry = dom.window.document.getElementById('geometry-result');
        assert.ok(geometry, `Browser did not return geometry for ${viewport.name}/${scenario}; `
            + `dump length ${output.length}.\n${output.slice(-2000)}\n${errors}`);
        const result = JSON.parse(Buffer.from(geometry.textContent, 'base64').toString('utf8'));
        dom.window.close();
        return result;
    } finally {
        const resolvedProfile = path.resolve(profileDir);
        assert.ok(resolvedProfile.startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(resolvedProfile, { recursive: true, force: true });
    }
}

function assertClose(actual, expected, tolerance, message) {
    assert.ok(Math.abs(actual - expected) <= tolerance,
        `${message}: expected ${expected} +/- ${tolerance}, received ${actual}`);
}

function assertRectEquals(actual, expected, message) {
    for (const [name, value] of Object.entries(expected)) {
        assertClose(actual[name], value, 1, `${message}.${name}`);
    }
}

function assertSameRow(left, right, message) {
    assertClose(left.top, right.top, 1, `${message}.top`);
    assertClose(left.bottom, right.bottom, 1, `${message}.bottom`);
}

function assertAdjacent(left, right, message) {
    assertClose(left.right, right.left, 1, message);
}

function assertGeometry(result, viewport, scenario) {
    const label = `${viewport.name}/${scenario}`;
    assertRectEquals(result.shell, {
        left: 0,
        top: 0,
        right: result.viewport.width,
        bottom: result.viewport.height,
    }, `${label} shell`);
    assert.strictEqual(result.document.scrollWidth, result.document.clientWidth, `${label} document width`);
    assert.strictEqual(result.document.scrollHeight, result.document.clientHeight, `${label} document height`);
    assertSameRow(result.navigation, result.properties, `${label} navigation/properties`);
    assertSameRow(result.properties, result.summary, `${label} properties/summary`);
    assertSameRow(result.address, result.status, `${label} address/status`);
    assertAdjacent(result.navigation, result.properties, `${label} navigation/properties adjacency`);
    assertAdjacent(result.properties, result.summary, `${label} properties/summary adjacency`);
    assertAdjacent(result.address, result.status, `${label} address/status adjacency`);
    assertClose(result.workbench.height / result.bottomBand.height, 4, 0.03,
        `${label} vertical ratio (${result.workbench.height}/${result.bottomBand.height}; `
        + `rows ${result.shellGridRows})`);
    assertClose(result.navigation.width / result.workbench.width, 0.23, 0.01, `${label} navigation ratio`);
    assertClose(result.properties.width / result.workbench.width, 0.46, 0.01, `${label} properties ratio`);
    assertClose(result.summary.width / result.workbench.width, 0.31, 0.01, `${label} summary ratio`);
    assertClose(result.address.width / result.bottomBand.width, 0.70, 0.01, `${label} address ratio`);
    assertClose(result.status.width / result.bottomBand.width, 0.30, 0.01, `${label} status ratio`);
    assertRectEquals(result.shellAfterScroll, result.shell, `${label} shell after scroll`);
    assertRectEquals(result.bottomBandAfterScroll, result.bottomBand, `${label} lower band after scroll`);
    for (const pane of ['navigation', 'properties', 'summary', 'address', 'status']) {
        assert.strictEqual(result[pane].overflowX, 'auto', `${label} ${pane} overflow-x`);
        assert.strictEqual(result[pane].overflowY, 'auto', `${label} ${pane} overflow-y`);
    }
    if (scenario === 'ports') {
        assert.ok(result.summary.scrollHeight > result.summary.clientHeight, `${label} Ports must overflow Summary`);
        assert.ok(result.scroll.after > result.scroll.before, `${label} Summary scrollTop must change`);
    } else if (scenario === 'routes') {
        assert.ok(result.properties.scrollHeight > result.properties.clientHeight,
            `${label} routes must overflow Properties`);
        assert.ok(result.scroll.after > result.scroll.before, `${label} Properties scrollTop must change`);
    }
}

function assertScenarioStableLowerBands(results, viewport) {
    const baseline = results.find((result) => result.scenario === scenarios[0]).bottomBand;
    for (const result of results.slice(1)) {
        assertClose(result.bottomBand.top, baseline.top, 1,
            `${viewport.name} lower-band top across scenarios`);
        assertClose(result.bottomBand.bottom, baseline.bottom, 1,
            `${viewport.name} lower-band bottom across scenarios`);
        assertClose(result.bottomBand.height, baseline.height, 1,
            `${viewport.name} lower-band height across scenarios`);
    }
}

async function main() {
    const executable = browserPath();
    fs.rmSync(screenshotRoot, { recursive: true, force: true });
    fs.mkdirSync(screenshotRoot, { recursive: true });
    const harness = startServer();
    try {
        const serverUrl = await harness.ready;
        let measurementCount = 0;
        for (const viewport of viewports) {
            const results = [];
            for (const scenario of scenarios) {
                const result = await launchBrowser(executable, serverUrl, viewport, scenario);
                assertGeometry(result, viewport, scenario);
                results.push(result);
                measurementCount += 1;
                console.log(`PASS ${viewport.name}/${scenario}: upper ${result.navigation.width.toFixed(1)}`
                    + `/${result.properties.width.toFixed(1)}/${result.summary.width.toFixed(1)}, lower `
                    + `${result.address.width.toFixed(1)}/${result.status.width.toFixed(1)}`);
            }
            assertScenarioStableLowerBands(results, viewport);
        }
        assert.strictEqual(measurementCount, 12);
        console.log(`MERC32 SoC browser geometry contracts passed (${measurementCount}/12 measurements).`);
    } finally {
        await stopServer(harness.server);
    }
}

main().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
