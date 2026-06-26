#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const nativeDir = path.join(root, 'assets', 'kws-model');
const webDir = path.join(root, 'public', 'sherpa', 'kws-model');
const required = [
  'encoder.onnx',
  'decoder.onnx',
  'joiner.onnx',
  'tokens.txt',
  'bpe.model',
  'keywords.txt',
  'manifest.json',
];
const optional = ['keywords_raw.txt'];

function fail(message) {
  console.error(`[aga:mirror-sherpa-web-assets] ERROR: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(nativeDir)) {
  fail(`Missing native Sherpa asset folder: ${path.relative(root, nativeDir)}. Run scripts/aga-sherpa-kws-setup.js first.`);
}

const missingNative = required.filter((file) => !fs.existsSync(path.join(nativeDir, file)));
if (missingNative.length) {
  fail(`Missing native Sherpa assets in ${path.relative(root, nativeDir)}: ${missingNative.join(', ')}`);
}

fs.mkdirSync(webDir, { recursive: true });
for (const file of [...required, ...optional]) {
  const src = path.join(nativeDir, file);
  if (!fs.existsSync(src)) continue;
  const dest = path.join(webDir, file);
  fs.copyFileSync(src, dest);
  console.log(`[aga:mirror-sherpa-web-assets] ${path.relative(root, src)} -> ${path.relative(root, dest)}`);
}

const missingWeb = required.filter((file) => !fs.existsSync(path.join(webDir, file)));
if (missingWeb.length) {
  fail(`Still missing browser Sherpa assets in ${path.relative(root, webDir)}: ${missingWeb.join(', ')}`);
}

console.log(`[aga:mirror-sherpa-web-assets] Browser Sherpa assets ready at ${path.relative(root, webDir)}`);
