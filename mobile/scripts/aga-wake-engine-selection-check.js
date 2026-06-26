#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const wake = path.join(root, 'src', 'voice', 'wakeEngine.ts');
const wasm = path.join(root, 'src', 'voice', 'sherpaWasmKwsRuntime.ts');

function fail(msg) {
  console.error(`[aga:wake-engine-selection-check] ERROR: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(wake)) fail('missing src/voice/wakeEngine.ts');
if (!fs.existsSync(wasm)) fail('missing src/voice/sherpaWasmKwsRuntime.ts');

const wakeText = fs.readFileSync(wake, 'utf8');
const wasmText = fs.readFileSync(wasm, 'utf8');

if (!wakeText.includes('SherpaWasmKeywordEngine')) fail('wakeEngine.ts does not import/use SherpaWasmKeywordEngine');
if (!wakeText.includes("Platform.OS === 'web'")) fail('wakeEngine.ts does not branch web runtime explicitly');
if (!wasmText.includes('createKws')) fail('sherpaWasmKwsRuntime.ts does not use createKws bridge');
if (/SpeechRecognition|webkitSpeechRecognition/.test(wakeText + wasmText)) fail('browser SpeechRecognition leaked into wake runtime');

console.log('[aga:wake-engine-selection-check] ok');
