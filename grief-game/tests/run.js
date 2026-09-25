#!/usr/bin/env node
/* Runs every tests/*.test.js in order. `npm test -- anger` runs only tests whose file or
 * name contains "anger". Screenshots land in tests/output/. Exits 1 if anything fails.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const lib = require('./lib');

function withTimeout(promise, ms, name) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(name + ' took longer than ' + ms / 1000 + 's')), ms); })
  ]);
}

(async () => {
  const filter = (process.argv[2] || '').toLowerCase();
  const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
  const tests = [];
  for (const f of files) {
    for (const t of require(path.join(__dirname, f))) tests.push(Object.assign({ file: f.replace('.test.js', '') }, t));
  }
  const chosen = tests.filter(t => (t.file + ' ' + t.name).toLowerCase().includes(filter));
  console.log('Running ' + chosen.length + ' test' + (chosen.length === 1 ? '' : 's') + (filter ? ' matching "' + filter + '"' : '') + '\n');
  await lib.setup();
  let failed = 0;
  const started = Date.now();
  for (const t of chosen) {
    const t0 = Date.now();
    const label = t.file + ' · ' + t.name;
    try {
      await withTimeout(t.run(lib), t.timeout || 120000, label);
      console.log('  ✓ ' + label + '  (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
    } catch (e) {
      failed++;
      console.log('  ✗ ' + label + '\n      ' + String(e && e.message || e).split('\n').join('\n      '));
    } finally {
      await lib.closeAll();
    }
  }
  await lib.teardown();
  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log('\n' + (chosen.length - failed) + ' passed, ' + failed + ' failed  (' + mins + ' min)');
  process.exit(failed ? 1 : 0);
})().catch(async e => {
  console.error(e);
  await lib.teardown();
  process.exit(1);
});
