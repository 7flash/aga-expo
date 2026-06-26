#!/usr/bin/env node
/**
 * Build Sherpa-ONNX WASM KWS runtime for browser Path A.
 *
 * This version copies only Sherpa's official WASM install output:
 *
 *   build-wasm-simd-kws/install/bin/wasm/
 *
 * It does not recursively scan the entire Sherpa repo, because generated build
 * folders can contain broken platform-specific helper paths/symlinks such as:
 *
 *   scripts/go/_internal/lib/aarch64-apple-darwin
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');

const root = process.cwd();
const args = new Set(process.argv.slice(2));

const cacheDir = path.join(root, '.aga-cache');
const sherpaDir = process.env.AGA_SHERPA_ONNX_SRC || path.join(cacheDir, 'sherpa-wasm-kws', 'sherpa-onnx');
const depsDir = path.join(cacheDir, 'sherpa-cmake-deps');
const kaldiArchive = path.join(depsDir, 'kaldi-decoder-v0.2.10.tar.gz');
const kaldiSha256 = 'a3d602edc1f422acfe663153faf3f0a716305ec1f95b8fcf9d28d301d6827309';

const outDir = path.join(root, 'public', 'sherpa', 'runtime', 'kws');
const sherpaRepo = process.env.AGA_SHERPA_ONNX_REPO || 'https://github.com/k2-fsa/sherpa-onnx.git';
const sherpaRef = process.env.AGA_SHERPA_ONNX_REF || 'master';

function run(cmd, argv, options = {}) {
  console.log(`[aga:sherpa-wasm-kws] $ ${[cmd, ...argv].join(' ')}`);
  const result = spawnSync(cmd, argv, {
    cwd: options.cwd || root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.status !== 0) throw new Error(`${[cmd, ...argv].join(' ')} failed with exit code ${result.status}`);
}

function commandOk(cmd, argv = ['--version']) {
  const result = spawnSync(cmd, argv, { cwd: root, stdio: 'ignore', shell: process.platform === 'win32' });
  return result.status === 0;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function ensureEmcc() {
  if (!commandOk('emcc')) throw new Error('Missing emcc. Activate Emscripten first: source ~/emsdk/emsdk_env.sh');
}

function ensureSherpaSource() {
  fs.mkdirSync(path.dirname(sherpaDir), { recursive: true });

  if (!fs.existsSync(path.join(sherpaDir, '.git'))) {
    fs.rmSync(sherpaDir, { recursive: true, force: true });
    run('git', ['clone', '--depth', '1', sherpaRepo, sherpaDir]);
  } else {
    run('git', ['fetch', '--depth', '1', 'origin', sherpaRef], { cwd: sherpaDir });
  }

  run('git', ['checkout', sherpaRef], { cwd: sherpaDir });
}

function maybePrefetchKaldi() {
  const prefetchScript = path.join(root, 'scripts', 'aga-prefetch-sherpa-cmake-deps.js');
  if (!fs.existsSync(prefetchScript)) return;

  run(process.execPath, [prefetchScript]);

  if (!fs.existsSync(kaldiArchive)) return;
  const got = sha256(kaldiArchive);
  if (got !== kaldiSha256) throw new Error(`kaldi-decoder archive hash mismatch: got ${got}, expected ${kaldiSha256}`);

  const cmakeFile = path.join(sherpaDir, 'cmake', 'kaldi-decoder.cmake');
  if (!fs.existsSync(cmakeFile)) return;

  const localUrl = pathToFileURL(kaldiArchive).toString();
  let text = fs.readFileSync(cmakeFile, 'utf8');
  text = text
    .replace(/set\(\s*kaldi_decoder_URL\s+"[^"]+"\s*\)/, `set(kaldi_decoder_URL "${localUrl}") # AGA_LOCAL_KALDI_DECODER`)
    .replace(/set\(\s*kaldi_decoder_URL2\s+"[^"]+"\s*\)/, `set(kaldi_decoder_URL2 "${localUrl}") # AGA_LOCAL_KALDI_DECODER`);
  fs.writeFileSync(cmakeFile, text);
  console.log(`[aga:sherpa-wasm-kws] patched kaldi decoder dependency to ${localUrl}`);
}

function injectKwsModelAssets() {
  const script = path.join(root, 'scripts', 'aga-copy-kws-assets-into-sherpa-wasm.js');
  if (!fs.existsSync(script)) throw new Error('Missing scripts/aga-copy-kws-assets-into-sherpa-wasm.js');
  run(process.execPath, [script], { env: { AGA_SHERPA_ONNX_SRC: sherpaDir } });
}

function removeOldBuilds() {
  for (const p of [
    path.join(sherpaDir, 'build-wasm-simd-kws'),
    path.join(sherpaDir, 'build-wasm-kws'),
    path.join(sherpaDir, 'wasm', 'kws', 'build'),
  ]) fs.rmSync(p, { recursive: true, force: true });
}

function build() {
  const script = path.join(sherpaDir, 'build-wasm-simd-kws.sh');
  if (!fs.existsSync(script)) throw new Error(`Missing ${script}`);
  if (args.has('--clean')) removeOldBuilds();
  try { fs.chmodSync(script, 0o755); } catch {}
  run('bash', ['./build-wasm-simd-kws.sh'], { cwd: sherpaDir });
}

function copyRuntimeArtifacts() {
  const wasmInstallDir = path.join(sherpaDir, 'build-wasm-simd-kws', 'install', 'bin', 'wasm');
  if (!fs.existsSync(wasmInstallDir)) throw new Error(`Missing WASM install output: ${wasmInstallDir}`);

  const entries = fs.readdirSync(wasmInstallDir)
    .filter((name) => /\.(js|wasm|data|html)$/.test(name))
    .map((name) => ({
      name,
      src: path.join(wasmInstallDir, name),
      size: fs.statSync(path.join(wasmInstallDir, name)).size,
    }));

  const required = [
    'sherpa-onnx-kws.js',
    'sherpa-onnx-wasm-kws-main.js',
    'sherpa-onnx-wasm-kws-main.wasm',
    'sherpa-onnx-wasm-kws-main.data',
  ];

  const missing = required.filter((name) => !entries.some((entry) => entry.name === name));
  if (missing.length) throw new Error(`Sherpa build output missing required browser KWS files: ${missing.join(', ')}`);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  for (const entry of entries) {
    fs.copyFileSync(entry.src, path.join(outDir, entry.name));
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    sourceRepo: sherpaRepo,
    sourceRef: sherpaRef,
    sourceDir: sherpaDir,
    installOutput: wasmInstallDir,
    outputDir: path.relative(root, outDir),
    files: entries.map((entry) => ({ name: entry.name, bytes: entry.size })),
    browserEntry: 'sherpa-onnx-kws.js',
    wasmMain: 'sherpa-onnx-wasm-kws-main.wasm',
    dataMain: 'sherpa-onnx-wasm-kws-main.data',
  };

  fs.writeFileSync(path.join(outDir, 'aga-kws-runtime-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('[aga:sherpa-wasm-kws] copied runtime artifacts', JSON.stringify(manifest, null, 2));
}

try {
  ensureEmcc();
  ensureSherpaSource();
  maybePrefetchKaldi();
  injectKwsModelAssets();
  build();
  copyRuntimeArtifacts();
} catch (error) {
  console.error(`[aga:sherpa-wasm-kws] ERROR: ${error.message || error}`);
  process.exit(1);
}
