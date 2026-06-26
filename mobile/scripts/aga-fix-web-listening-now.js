#!/usr/bin/env node
/**
 * One-command repair for AGA browser listening.
 *
 * This does not enable Android SpeechRecognizer or browser SpeechRecognition.
 * It prepares the real browser path: Sherpa-ONNX WebAssembly + public model assets.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const root = process.cwd();
const pkgPath = path.join(root, 'package.json');
const setupScript = path.join(root, 'scripts', 'aga-sherpa-kws-setup.js');
const assetCheckScript = path.join(root, 'scripts', 'aga-sherpa-runtime-assets-check.js');
const wakeCheckScript = path.join(root, 'scripts', 'aga-wake-listening-check.js');
const webModelDir = path.join(root, 'public', 'sherpa', 'kws-model');
const nativeModelDir = path.join(root, 'assets', 'kws-model');
const required = ['encoder.onnx', 'decoder.onnx', 'joiner.onnx', 'tokens.txt', 'bpe.model', 'keywords.txt', 'manifest.json'];

function log(...args) { console.log('[aga:fix-web-listening]', ...args); }
function warn(...args) { console.warn('[aga:fix-web-listening] WARN:', ...args); }
function fail(message) { console.error('[aga:fix-web-listening] ERROR:', message); process.exit(1); }
function run(cmd, args, opts = {}) {
  log('$', [cmd, ...args].join(' '));
  const result = cp.spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (result.status !== 0) fail(`${cmd} ${args.join(' ')} failed with exit code ${result.status}`);
}
function hasBin(cmd) {
  const result = cp.spawnSync(process.platform === 'win32' ? 'where' : 'command', process.platform === 'win32' ? [cmd] : ['-v', cmd], { stdio: 'ignore', shell: process.platform !== 'win32' });
  return result.status === 0;
}
function pkg() {
  if (!fs.existsSync(pkgPath)) fail(`Run this from the Expo mobile project root. Missing ${pkgPath}`);
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
}
function deps() {
  const p = pkg();
  return { ...(p.dependencies || {}), ...(p.devDependencies || {}) };
}
function packageManager() {
  if (fs.existsSync(path.join(root, 'bun.lockb')) || fs.existsSync(path.join(root, 'bun.lock')) || hasBin('bun')) return { cmd: 'bun', add: ['add'] };
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml')) || hasBin('pnpm')) return { cmd: 'pnpm', add: ['add'] };
  if (fs.existsSync(path.join(root, 'yarn.lock')) || hasBin('yarn')) return { cmd: 'yarn', add: ['add'] };
  return { cmd: 'npm', add: ['install'] };
}
function missingAssets(dir) {
  return required.filter((file) => !fs.existsSync(path.join(dir, file)));
}
function ensureEnvHint() {
  const envPath = path.join(root, '.env');
  const lines = [
    'EXPO_PUBLIC_AGA_KEYWORD_ENGINE=sherpa',
    'EXPO_PUBLIC_AGA_BROWSER_KEYWORD_ENGINE=sherpa_wasm',
    'EXPO_PUBLIC_AGA_ALLOW_DEV_KEYWORD_INJECTOR=0',
  ];
  if (!fs.existsSync(envPath)) {
    warn('No .env found. Create one or ensure these are exported before starting Expo:');
    for (const line of lines) warn('  ' + line);
    return;
  }
  const content = fs.readFileSync(envPath, 'utf8');
  const missing = lines.filter((line) => !content.includes(line.split('=')[0] + '='));
  if (missing.length) {
    warn('.env is missing browser listening hints. Add:');
    for (const line of missing) warn('  ' + line);
  }
}

const args = new Set(process.argv.slice(2));
const force = args.has('--force') || args.has('-f');
const int8 = args.has('--int8');

if (!deps()['sherpa-onnx']) {
  const pm = packageManager();
  log('Installing Sherpa-ONNX WebAssembly runtime package. This is for browser preview only.');
  run(pm.cmd, [...pm.add, 'sherpa-onnx']);
} else {
  log('sherpa-onnx dependency already present');
}

if (!fs.existsSync(setupScript)) {
  fail(`Missing ${setupScript}. Apply the Sherpa one-script/setup patch first.`);
}

const webMissing = missingAssets(webModelDir);
const nativeMissing = missingAssets(nativeModelDir);
if (force || webMissing.length || nativeMissing.length) {
  log('Generating/mirroring Sherpa KWS assets');
  run(process.execPath, [setupScript, ...(int8 ? ['--int8'] : []), ...(force ? ['--force'] : [])]);
} else {
  log('Sherpa model assets already present');
}

const finalWebMissing = missingAssets(webModelDir);
if (finalWebMissing.length) fail(`Still missing browser model assets in public/sherpa/kws-model: ${finalWebMissing.join(', ')}`);

ensureEnvHint();

if (fs.existsSync(assetCheckScript)) run(process.execPath, [assetCheckScript]);
if (fs.existsSync(wakeCheckScript)) run(process.execPath, [wakeCheckScript]);

log('Browser listening prerequisites are present. Now restart Expo with a clean cache:');
log('  npx expo start -c');
log('If the browser still says Sherpa web runtime missing, paste the full console error that includes “Export keys”.');
