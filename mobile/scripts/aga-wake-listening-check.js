#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const pkgPath = path.join(root, 'package.json');
const required = ['encoder.onnx', 'decoder.onnx', 'joiner.onnx', 'tokens.txt', 'bpe.model', 'keywords.txt', 'manifest.json'];
const webModelDir = path.join(root, 'public', 'sherpa', 'kws-model');
const nativeModelDir = path.join(root, 'assets', 'kws-model');

function log(...args) { console.log('[aga:wake-listening-check]', ...args); }
function fail(message) { console.error('[aga:wake-listening-check] ERROR:', message); process.exitCode = 1; }
function warn(message) { console.warn('[aga:wake-listening-check] WARN:', message); }
function missing(dir) { return required.filter((file) => !fs.existsSync(path.join(dir, file))); }
function deps() {
  if (!fs.existsSync(pkgPath)) return {};
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
}

const d = deps();
if (!d['sherpa-onnx']) fail('Browser Sherpa WebAssembly runtime package is missing. Run: node scripts/aga-fix-web-listening-now.js');
else log('sherpa-onnx dependency present');

const webMissing = missing(webModelDir);
if (webMissing.length) fail(`Browser model assets missing in public/sherpa/kws-model: ${webMissing.join(', ')}. Run: node scripts/aga-fix-web-listening-now.js --force`);
else log('browser Sherpa assets present');

const nativeMissing = missing(nativeModelDir);
if (nativeMissing.length) warn(`Native model assets missing in assets/kws-model: ${nativeMissing.join(', ')}. Android will need them before release.`);
else log('native Sherpa assets present');

const env = {
  EXPO_PUBLIC_AGA_KEYWORD_ENGINE: process.env.EXPO_PUBLIC_AGA_KEYWORD_ENGINE || '(default sherpa)',
  EXPO_PUBLIC_AGA_BROWSER_KEYWORD_ENGINE: process.env.EXPO_PUBLIC_AGA_BROWSER_KEYWORD_ENGINE || '(default sherpa_wasm)',
  EXPO_PUBLIC_AGA_ALLOW_DEV_KEYWORD_INJECTOR: process.env.EXPO_PUBLIC_AGA_ALLOW_DEV_KEYWORD_INJECTOR || '0',
};
log(env);
if (String(env.EXPO_PUBLIC_AGA_ALLOW_DEV_KEYWORD_INJECTOR) === '1') warn('Dev keyword injector is enabled. Turn it off for real browser Sherpa testing.');

if (process.exitCode) {
  console.error('\nWake engine is not ready. FTS5 warnings are unrelated; fix Sherpa runtime/assets first.');
} else {
  log('OK. Restart Expo with: npx expo start -c');
}
