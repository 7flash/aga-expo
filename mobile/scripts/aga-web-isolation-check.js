#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const metro = path.join(root, 'metro.config.js');

function fail(message) {
  console.error(`[aga:web-isolation-check] ERROR: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(metro)) fail('missing metro.config.js');

const text = fs.readFileSync(metro, 'utf8');

for (const required of [
  'Cross-Origin-Opener-Policy',
  'Cross-Origin-Embedder-Policy',
  'same-origin',
  'require-corp',
  'Origin-Agent-Cluster',
  'enhanceMiddleware',
]) {
  if (!text.includes(required)) fail(`metro.config.js missing ${required}`);
}

console.log('[aga:web-isolation-check] ok');
