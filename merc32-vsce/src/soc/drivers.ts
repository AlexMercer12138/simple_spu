import { SocPlan } from './model';

const DRIVER_TYPES: Readonly<Record<string, string>> = Object.freeze({
    apb_can: 'can', apb_gpio: 'gpio', apb_i2c: 'i2c', apb_intc: 'intc',
    apb_qspi: 'qspi', apb_sdio: 'sdio', apb_timer: 'timer', apb_uart: 'uart',
});

export function selectedDrivers(plan: SocPlan): readonly string[] {
    return [...new Set(plan.peripherals.flatMap(peripheral => {
        const name = Object.prototype.hasOwnProperty.call(DRIVER_TYPES, peripheral.type)
            ? DRIVER_TYPES[peripheral.type] : undefined;
        return name === undefined ? [] : [name];
    }))].sort();
}

export function driverResourceFiles(plan: SocPlan): readonly string[] {
    return selectedDrivers(plan).flatMap(name => [`drivers/${name}.c`, `drivers/${name}.h`]);
}

export function renderDriverIncludes(plan: SocPlan): string {
    return [
        '#ifndef MERC32_SOC_DRIVER_IMPLEMENTATIONS_INCLUDED',
        '#define MERC32_SOC_DRIVER_IMPLEMENTATIONS_INCLUDED',
        '/* Include once from the application translation unit. */',
        ...selectedDrivers(plan).map(name => `#include "${name}.c"`),
        '#endif', '',
    ].join('\n');
}
