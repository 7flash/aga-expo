#!/usr/bin/env node
/**
 * Compatibility launcher. Prefer:
 *   node scripts/aga-setup-sherpa-browser-all.js --force --no-start
 */
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.join(process.cwd(), 'scripts', 'aga-setup-sherpa-browser-all.js');
const result = spawnSync(process.execPath, [script, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: 'inherit',
});
process.exit(result.status || 0);
