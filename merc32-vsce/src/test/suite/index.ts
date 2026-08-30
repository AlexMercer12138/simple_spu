import * as fs from 'fs';
import * as path from 'path';

import Mocha from 'mocha';

export async function run(): Promise<void> {
    const mocha = new Mocha({
        color: true,
        timeout: 120_000,
        ui: 'tdd',
    });
    for (const file of fs.readdirSync(__dirname).filter((name) => name.endsWith('.test.js')).sort()) {
        mocha.addFile(path.join(__dirname, file));
    }
    await new Promise<void>((resolve, reject) => {
        mocha.run((failures) => {
            if (failures === 0) {
                resolve();
            } else {
                reject(new Error(`${failures} MERC32 extension-host test(s) failed.`));
            }
        });
    });
}
