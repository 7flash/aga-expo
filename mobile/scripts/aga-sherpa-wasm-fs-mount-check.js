#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const file = path.join(root, 'src', 'voice', 'sherpaWasmKwsRuntime.ts');

function fail(message) {
  console.error(`[aga:sherpa-wasm-fs-mount-check] ERROR: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(file)) fail('missing src/voice/sherpaWasmKwsRuntime.ts');

const text = fs.readFileSync(file, 'utf8');

for (const required of [
  '/aga-kws-model',
  'mountModelAssets',
  'FS.writeFile',
  'FS_createDataFile',
  'encoder: `${WASM_MODEL_DIR}/encoder.onnx`',
  'tokens: `${WASM_MODEL_DIR}/tokens.txt`',
]) {
  if (!text.includes(required)) fail(`runtime missing ${required}`);
}

if (text.includes("tokens: `${modelBaseUrl}/tokens.txt`")) {
  fail('runtime still passes browser URL as tokens path');
}

console.log('[aga:sherpa-wasm-fs-mount-check] ok');
