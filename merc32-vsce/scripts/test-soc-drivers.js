const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const soc = require('../out/soc');
const { compileCFileDetailed } = require('../out/cCompiler');
const { SimpleCPUAssembler } = require('../out/assembler');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-soc-drivers-'));
const assetRoot = path.resolve(__dirname, '../resources');
const configFile = path.join(root, 'drivers.merc32.json');
const config = require('./fixtures/soc/all-peripherals.merc32.json');
config.project = { name: 'driver_soc', outputDir: 'generated' };
config.peripherals.push({ type: 'apb_gpio', name: 'gpio1', baseAddress: '0x10008000' });
const names = ['can', 'gpio', 'i2c', 'intc', 'qspi', 'sdio', 'timer', 'uart'];
const writeConfig = () => fs.writeFileSync(configFile, JSON.stringify(config));
const generate = (extra = {}) => soc.generateSoc({ configFile, assetRoot, ...extra });
const output = path.join(root, 'generated');

try {
    writeConfig();
    generate();
    for (const name of names) {
        for (const ext of ['c', 'h']) {
            const relative = `drivers/${name}.${ext}`;
            const generated = path.join(output, 'software', relative);
            assert.ok(fs.existsSync(generated), `missing generated driver ${relative}`);
            assert.deepEqual(fs.readFileSync(generated), fs.readFileSync(path.join(assetRoot, relative)));
        }
    }
    const aggregate = path.join(output, 'software/drivers/merc32_drivers.h');
    assert.equal(fs.readFileSync(aggregate, 'utf8').match(/"gpio\.c"/g).length, 1);
    const main = path.join(output, 'software/main.c');
    const source = '#include "driver_soc.h"\n#include "drivers/merc32_drivers.h"\n'
        + 'int main(void) { gpio_handle_t a = {0}, b = {0}; '
        + 'gpio_init(&a, DRIVER_SOC_GPIO0_BASE); gpio_init(&b, DRIVER_SOC_GPIO1_BASE); '
        + 'gpio_set_mask(&a, 1); gpio_clear_mask(&b, 2); return 0; }\n';
    fs.writeFileSync(main, source);
    for (const optimization of ['none', 'basic']) {
        const compiled = compileCFileDetailed(main, { optimization, dlbAddrWidth: 14 });
        assert.ok(compiled.artifact, JSON.stringify(compiled.diagnostics));
        assert.ok(new SimpleCPUAssembler().assemble(compiled.artifact.assembly).machineCodes.length > 0);
    }
    generate();
    assert.equal(fs.readFileSync(main, 'utf8'), source, 'regeneration overwrote application');
    const driverFile = path.join(output, 'software/drivers/gpio.c');
    fs.appendFileSync(driverFile, '\n/* user edit */\n');
    assert.throws(() => generate(), error => error.conflicts.some(c => c.path === 'software/drivers/gpio.c'));
    generate({ force: true });
    config.peripherals = [];
    config.interrupt = { mode: 'none' };
    writeConfig();
    generate();
    assert.ok(!fs.existsSync(driverFile), 'removed peripheral driver was not cleaned up');
    assert.ok(!fs.readFileSync(aggregate, 'utf8').includes('#include'));
    assert.equal(fs.readFileSync(main, 'utf8'), source);
    console.log('SoC drivers passed: eight types, deduplication, none/basic ROM, regeneration, conflicts, removal.');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
