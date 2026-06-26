#!/usr/bin/env node
/**
 * Verifies browser Sherpa KWS runtime files from Sherpa's official output.
 */
const fs = require('fs');
const path = require('path');

const root = process.cwd();

const modelRequired = [
  'public/sherpa/kws-model/encoder.onnx',
  'public/sherpa/kws-model/decoder.onnx',
  'public/sherpa/kws-model/joiner.onnx',
  'public/sherpa/kws-model/tokens.txt',
  'public/sherpa/kws-model/bpe.model',
  'public/sherpa/kws-model/keywords.txt',
  'public/sherpa/kws-model/manifest.json',
];

const runtimeRequired = [
  'public/sherpa/runtime/kws/sherpa-onnx-kws.js',
  'public/sherpa/runtime/kws/sherpa-onnx-wasm-kws-main.js',
  'public/sherpa/runtime/kws/sherpa-onnx-wasm-kws-main.wasm',
  'public/sherpa/runtime/kws/sherpa-onnx-wasm-kws-main.data',
  'public/sherpa/runtime/kws/aga-kws-runtime-manifest.json',
];

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function size(rel) {
  return fs.statSync(path.join(root, rel)).size;
}

function fail(message, details) {
  console.error(`[aga:sherpa-wasm-contract] ERROR: ${message}`);
  for (const detail of details || []) console.error(`  - ${detail}`);
  console.error('');
  console.error('Run:');
  console.error('  source ~/emsdk/emsdk_env.sh');
  console.error('  node scripts/aga-setup-sherpa-browser-all.js --force --clean --no-start');
  process.exit(1);
}

const missingModels = modelRequired.filter((rel) => !exists(rel));
if (missingModels.length) fail('missing browser model assets', missingModels);

const missingRuntime = runtimeRequired.filter((rel) => !exists(rel));
if (missingRuntime.length) fail('missing browser Sherpa runtime files', missingRuntime);

if (size('public/sherpa/runtime/kws/sherpa-onnx-wasm-kws-main.wasm') < 1024 * 1024) {
  fail('WASM file looks too small', [`${size('public/sherpa/runtime/kws/sherpa-onnx-wasm-kws-main.wasm')} bytes`]);
}

if (size('public/sherpa/runtime/kws/sherpa-onnx-wasm-kws-main.data') < 1024 * 1024) {
  fail('DATA file looks too small', [`${size('public/sherpa/runtime/kws/sherpa-onnx-wasm-kws-main.data')} bytes`]);
}

console.log('[aga:sherpa-wasm-contract] ok', JSON.stringify({
  modelDir: 'public/sherpa/kws-model',
  runtimeDir: 'public/sherpa/runtime/kws',
  entry: 'sherpa-onnx-kws.js',
  wasm: {
    file: 'sherpa-onnx-wasm-kws-main.wasm',
    bytes: size('public/sherpa/runtime/kws/sherpa-onnx-wasm-kws-main.wasm'),
  },
  data: {
    file: 'sherpa-onnx-wasm-kws-main.data',
    bytes: size('public/sherpa/runtime/kws/sherpa-onnx-wasm-kws-main.data'),
  },
}, null, 2));
