#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const force = args.has('--force');
const int8 = args.has('--int8');
const nativeDir = path.join(root, 'assets', 'kws-model');
const webDir = path.join(root, 'public', 'sherpa', 'kws-model');
const required = ['encoder.onnx', 'decoder.onnx', 'joiner.onnx', 'tokens.txt', 'bpe.model', 'keywords.txt', 'manifest.json'];

function log(message) {
  console.log(`[aga:fix-web-listening] ${message}`);
}

function fail(message) {
  console.error(`[aga:fix-web-listening] ERROR: ${message}`);
  process.exit(1);
}

function run(command, commandArgs, options = {}) {
  log(`$ ${[command, ...commandArgs].join(' ')}`);
  const result = cp.spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.status !== 0) {
    fail(`${command} ${commandArgs.join(' ')} failed with exit code ${result.status}`);
  }
}

function existsAll(dir) {
  return required.every((file) => fs.existsSync(path.join(dir, file)));
}

function missing(dir) {
  return required.filter((file) => !fs.existsSync(path.join(dir, file)));
}

function packageInstalled(name) {
  try {
    require.resolve(`${name}/package.json`, { paths: [root] });
    return true;
  } catch (_) {
    return false;
  }
}

function packageManager() {
  if (fs.existsSync(path.join(root, 'bun.lockb')) || fs.existsSync(path.join(root, 'bun.lock'))) return ['bun', ['add']];
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return ['pnpm', ['add']];
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return ['yarn', ['add']];
  return ['npm', ['install']];
}

if (!packageInstalled('sherpa-onnx')) {
  log('Installing Sherpa-ONNX WebAssembly runtime package. This is for browser preview only.');
  const [pm, addArgs] = packageManager();
  run(pm, [...addArgs, 'sherpa-onnx']);
} else {
  log('Sherpa-ONNX WebAssembly runtime package is installed.');
}

if (force || !existsAll(nativeDir)) {
  const setup = path.join(root, 'scripts', 'aga-sherpa-kws-setup.js');
  if (!fs.existsSync(setup)) fail('Missing scripts/aga-sherpa-kws-setup.js');
  log('Generating native Sherpa KWS assets');
  run(process.execPath, [setup, ...(force ? ['--force'] : []), ...(int8 ? ['--int8'] : [])]);
}

if (!existsAll(nativeDir)) {
  fail(`Missing native Sherpa assets in ${path.relative(root, nativeDir)}: ${missing(nativeDir).join(', ')}`);
}

fs.mkdirSync(webDir, { recursive: true });
for (const file of [...required, 'keywords_raw.txt']) {
  const src = path.join(nativeDir, file);
  if (!fs.existsSync(src)) continue;
  const dest = path.join(webDir, file);
  fs.copyFileSync(src, dest);
  log(`${path.relative(root, src)} -> ${path.relative(root, dest)}`);
}

if (!existsAll(webDir)) {
  fail(`Still missing browser model assets in ${path.relative(root, webDir)}: ${missing(webDir).join(', ')}`);
}

log('Browser listening runtime is ready. Restart Expo with cache clear: npx expo start -c');
