#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const root = process.cwd();
const modelDir = path.join(root, 'public', 'sherpa', 'kws-model');
const runtimeDir = path.join(root, 'public', 'sherpa', 'runtime', 'kws');
const requiredModels = ['encoder.onnx', 'decoder.onnx', 'joiner.onnx', 'tokens.txt', 'bpe.model', 'keywords.txt', 'manifest.json'];
const missingModels = requiredModels.filter((f) => !fs.existsSync(path.join(modelDir, f)));
const runtimeFiles = fs.existsSync(runtimeDir) ? fs.readdirSync(runtimeDir) : [];
const hasJs = runtimeFiles.some((f) => f.endsWith('.js'));
const hasWasm = runtimeFiles.some((f) => f.endsWith('.wasm'));
const hasManifest = runtimeFiles.includes('aga-kws-runtime-manifest.json');
let ok = true;
function err(x) { ok = false; console.error('[aga:sherpa-wasm-kws-check] ERROR:', x); }
function log(x) { console.log('[aga:sherpa-wasm-kws-check]', x); }
if (missingModels.length) err(`missing web model files in public/sherpa/kws-model: ${missingModels.join(', ')}`);
if (!hasJs) err('missing generated Sherpa WASM KWS JavaScript runtime in public/sherpa/runtime/kws');
if (!hasWasm) err('missing generated Sherpa WASM KWS .wasm file in public/sherpa/runtime/kws');
if (!hasManifest) err('missing aga-kws-runtime-manifest.json in public/sherpa/runtime/kws');
if (!fs.existsSync(path.join(root, 'assets', 'kws-model'))) err('missing canonical assets/kws-model directory');
if (ok) {
  log('OK: web model assets and generated WASM KWS runtime are present.');
  log(`runtime files: ${runtimeFiles.join(', ')}`);
} else {
  console.error('\nFix order:');
  console.error('  node scripts/aga-sherpa-kws-setup.js --force');
  console.error('  node scripts/aga-mirror-sherpa-web-assets.js');
  console.error('  node scripts/aga-build-sherpa-wasm-kws.js');
  process.exit(1);
}
