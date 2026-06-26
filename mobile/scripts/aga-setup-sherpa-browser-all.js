#!/usr/bin/env node
/**
 * One command for AGA browser Sherpa Path A setup.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const emsdkDir = process.env.EMSDK || path.join(os.homedir(), 'emsdk');
const emsdkEnv = path.join(emsdkDir, 'emsdk_env.sh');

function run(cmd, argv, options = {}) {
  console.log(`[aga:sherpa-browser-all] $ ${[cmd, ...argv].join(' ')}`);
  const result = spawnSync(cmd, argv, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

function commandOk(cmd, argv = ['--version']) {
  const result = spawnSync(cmd, argv, { cwd: root, stdio: 'ignore', shell: process.platform === 'win32' });
  return result.status === 0;
}

function bash(command) {
  run('bash', ['-lc', command], { shell: false });
}

function script(name) {
  return path.join(root, 'scripts', name);
}

function runScript(name, argv = []) {
  const p = script(name);
  if (!fs.existsSync(p)) {
    console.error(`[aga:sherpa-browser-all] ERROR: missing scripts/${name}`);
    process.exit(1);
  }
  run(process.execPath, [p, ...argv]);
}

function installEmscriptenIfRequested() {
  if (commandOk('emcc')) return;

  if (!args.has('--install-emscripten')) {
    console.error('[aga:sherpa-browser-all] ERROR: emcc not found.');
    console.error('Run one of:');
    console.error('  source ~/emsdk/emsdk_env.sh');
    console.error('  node scripts/aga-setup-sherpa-browser-all.js --force --install-emscripten --no-start');
    process.exit(2);
  }

  if (!fs.existsSync(emsdkDir)) {
    run('git', ['clone', 'https://github.com/emscripten-core/emsdk.git', emsdkDir]);
  } else {
    bash(`cd "${emsdkDir}" && git pull --ff-only || true`);
  }

  bash(`cd "${emsdkDir}" && ./emsdk install latest && ./emsdk activate latest`);
}

function runBuild() {
  if (commandOk('emcc')) {
    runScript('aga-build-sherpa-wasm-kws.js', args.has('--clean') ? ['--clean'] : []);
    return;
  }

  if (fs.existsSync(emsdkEnv)) {
    const extra = args.has('--clean') ? ' --clean' : '';
    bash(`source "${emsdkEnv}" && cd "${root}" && "${process.execPath}" "${script('aga-build-sherpa-wasm-kws.js')}"${extra}`);
    return;
  }

  console.error(`[aga:sherpa-browser-all] ERROR: emsdk env not found at ${emsdkEnv}`);
  process.exit(2);
}

const setupArgs = [];
if (args.has('--force')) setupArgs.push('--force');
if (args.has('--int8')) setupArgs.push('--int8');

runScript('aga-sherpa-kws-setup.js', setupArgs);
runScript('aga-mirror-sherpa-web-assets.js');
installEmscriptenIfRequested();

if (fs.existsSync(script('aga-prefetch-sherpa-cmake-deps.js'))) {
  runScript('aga-prefetch-sherpa-cmake-deps.js');
}

runBuild();

if (fs.existsSync(script('aga-sherpa-wasm-runtime-contract-check.js'))) {
  runScript('aga-sherpa-wasm-runtime-contract-check.js');
}

if (!args.has('--no-start')) {
  run('npx', ['expo', 'start', '-c', '--web']);
}
