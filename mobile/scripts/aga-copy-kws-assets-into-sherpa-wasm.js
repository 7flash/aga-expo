#!/usr/bin/env node
/**
 * Copy AGA's canonical KWS model assets into Sherpa's WASM build asset folder.
 *
 * Sherpa's official build-wasm-simd-kws.sh requires these exact filenames:
 *
 *   wasm/kws/assets/encoder-epoch-12-avg-2-chunk-16-left-64.onnx
 *   wasm/kws/assets/decoder-epoch-12-avg-2-chunk-16-left-64.onnx
 *   wasm/kws/assets/joiner-epoch-12-avg-2-chunk-16-left-64.onnx
 *   wasm/kws/assets/tokens.txt
 *
 * AGA's canonical runtime assets are simpler:
 *
 *   assets/kws-model/encoder.onnx
 *   assets/kws-model/decoder.onnx
 *   assets/kws-model/joiner.onnx
 *   assets/kws-model/tokens.txt
 */
const fs = require('fs');
const path = require('path');

const root = process.cwd();

const sourceDir = path.join(root, 'assets', 'kws-model');

const candidateSherpaDirs = [
  process.env.AGA_SHERPA_ONNX_SRC,
  path.join(root, '.aga-cache', 'sherpa-wasm-kws', 'sherpa-onnx'),
  path.join(root, '.aga-cache', 'sherpa-onnx-src'),
].filter(Boolean);

const mapping = [
  ['encoder.onnx', 'encoder-epoch-12-avg-2-chunk-16-left-64.onnx'],
  ['decoder.onnx', 'decoder-epoch-12-avg-2-chunk-16-left-64.onnx'],
  ['joiner.onnx', 'joiner-epoch-12-avg-2-chunk-16-left-64.onnx'],
  ['tokens.txt', 'tokens.txt'],
];

function fail(message) {
  console.error(`[aga:copy-kws-wasm-assets] ERROR: ${message}`);
  process.exit(1);
}

function findSherpaDir() {
  for (const dir of candidateSherpaDirs) {
    if (!dir) continue;
    if (fs.existsSync(path.join(dir, 'wasm', 'kws', 'CMakeLists.txt'))) return dir;
  }
  fail(`could not find Sherpa source. Checked:\n${candidateSherpaDirs.map((d) => `  - ${d}`).join('\n')}\nRun the builder once so it clones Sherpa, or set AGA_SHERPA_ONNX_SRC=/path/to/sherpa-onnx.`);
}

if (!fs.existsSync(sourceDir)) {
  fail(`missing ${path.relative(root, sourceDir)}. Run node scripts/aga-sherpa-kws-setup.js --force first.`);
}

const missing = mapping
  .map(([src]) => src)
  .filter((src) => !fs.existsSync(path.join(sourceDir, src)));

if (missing.length) {
  fail(`missing canonical model assets in ${path.relative(root, sourceDir)}: ${missing.join(', ')}`);
}

const sherpaDir = findSherpaDir();
const targetDir = path.join(sherpaDir, 'wasm', 'kws', 'assets');
fs.mkdirSync(targetDir, { recursive: true });

// Sherpa's README warns to remove extra files from this folder.
// Preserve README.md and remove generated leftovers.
for (const item of fs.readdirSync(targetDir)) {
  if (item === 'README.md') continue;
  fs.rmSync(path.join(targetDir, item), { recursive: true, force: true });
}

for (const [srcName, dstName] of mapping) {
  const src = path.join(sourceDir, srcName);
  const dst = path.join(targetDir, dstName);
  fs.copyFileSync(src, dst);
}

const expected = mapping.map(([, dst]) => dst);
const stillMissing = expected.filter((name) => !fs.existsSync(path.join(targetDir, name)));
if (stillMissing.length) {
  fail(`copy failed; still missing in ${targetDir}: ${stillMissing.join(', ')}`);
}

console.log('[aga:copy-kws-wasm-assets] ok', JSON.stringify({
  source: path.relative(root, sourceDir),
  sherpaSource: path.relative(root, sherpaDir),
  target: path.relative(root, targetDir),
  files: expected,
}, null, 2));
