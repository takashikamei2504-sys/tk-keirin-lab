'use strict';
require('../tests/next-brain-prep.test.cjs');
require('../tests/sequential-brain.test.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const baseline = require('../research/next-brain/baseline.json');
for (const [file, expected] of Object.entries(baseline.sha256)) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex');
  if (actual !== expected) throw new Error(`Baseline changed: ${file}. Review the comparison baseline explicitly.`);
}
console.log(`Baseline preserved: ${baseline.engineVersion}`);
console.log('Sequential engine, contextual memory, mass accounting and the published UI adapter passed. Original baseline preserved.');
