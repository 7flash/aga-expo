#!/usr/bin/env node
/**
 * Static sanity check for Sherpa browser KWS generated output.
 */
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const runtimeDir = path.join(root, 'public', 'sherpa', 'runtime', 'kws');
const helper = path.join(runtimeDir, 'sherpa-onnx-kws.js');
const main = path.join(runtimeDir, 'sherpa-onnx-wasm-kws-main.js');
const wasm = path.join(runtimeDir, 'sherpa-onnx-wasm-kws-main.wasm');
const data = path.join(runtimeDir, 'sherpa-onnx-wasm-kws-main.data');

function fail(message) {
  console.error(`[aga:sherpa-wasm-api-check] ERROR: ${message}`);
  process.exit(1);
}

for (const file of [helper, main, wasm, data]) {
  if (!fs.existsSync(file)) fail(`missing ${path.relative(root, file)}`);
}

const text = fs.readFileSync(helper, 'utf8');
for (const symbol of ['createKws', 'createStream', 'acceptWaveform', 'getResult', 'reset']) {
  if (!text.includes(symbol)) fail(`sherpa-onnx-kws.js does not contain expected symbol ${symbol}`);
}

if (fs.statSync(wasm).size < 1024 * 1024) fail('wasm file looks too small');
if (fs.statSync(data).size < 1024 * 1024) fail('data file looks too small');

console.log('[aga:sherpa-wasm-api-check] ok', JSON.stringify({
  runtimeDir: path.relative(root, runtimeDir),
  helperBytes: fs.statSync(helper).size,
  mainBytes: fs.statSync(main).size,
  wasmBytes: fs.statSync(wasm).size,
  dataBytes: fs.statSync(data).size,
}, null, 2));
