'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Keep the output directory exact: this script is intentionally unable to
// remove anything outside the package's generated compiler output.
const outputDirectory = path.resolve(__dirname, '..', 'out');
if (fs.existsSync(outputDirectory)) {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
}
