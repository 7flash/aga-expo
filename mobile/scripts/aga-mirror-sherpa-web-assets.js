#!/usr/bin/env node
/**
 * Mirror canonical Sherpa KWS model assets for Expo Web.
 *
 * Canonical/native source:
 *   assets/kws-model
 *
 * Browser static serving target:
 *   public/sherpa/kws-model
 *
 * The public copy should be generated and gitignored. Expo Web serves files
 * from public/ by URL; Metro/native can bundle from assets/.
 */
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const srcDir = path.join(root, 'assets', 'kws-model');
const dstDir = path.join(root, 'public', 'sherpa', 'kws-model');

const required = [
  'encoder.onnx',
  'decoder.onnx',
  'joiner.onnx',
  'tokens.txt',
  'bpe.model',
  'keywords.txt',
  'manifest.json',
];

function fail(message) {
  console.error(`[aga:mirror-sherpa-web-assets] ERROR: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(srcDir)) {
  fail(`missing source directory ${path.relative(root, srcDir)}. Run node scripts/aga-sherpa-kws-setup.js --force first.`);
}

const missing = required.filter((file) => !fs.existsSync(path.join(srcDir, file)));
if (missing.length) {
  fail(`missing source model assets in ${path.relative(root, srcDir)}: ${missing.join(', ')}`);
}

fs.mkdirSync(dstDir, { recursive: true });

for (const file of fs.readdirSync(srcDir)) {
  const src = path.join(srcDir, file);
  const dst = path.join(dstDir, file);
  if (fs.statSync(src).isFile()) {
    fs.copyFileSync(src, dst);
  }
}

const stillMissing = required.filter((file) => !fs.existsSync(path.join(dstDir, file)));
if (stillMissing.length) {
  fail(`mirror failed; still missing in ${path.relative(root, dstDir)}: ${stillMissing.join(', ')}`);
}

console.log('[aga:mirror-sherpa-web-assets] ok', JSON.stringify({
  from: path.relative(root, srcDir),
  to: path.relative(root, dstDir),
  files: required.length,
}, null, 2));
