#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const env = { ...readEnv(path.resolve(process.cwd(), '.env')), ...process.env };
const engine = String(env.EXPO_PUBLIC_AGA_ENGINE || '').toLowerCase();
const transport = String(env.EXPO_PUBLIC_AGA_GEMINI_TRANSPORT || env.EXPO_PUBLIC_GEMINI_TRANSPORT || '').toLowerCase() || 'text';
const hasKey = !!(env.EXPO_PUBLIC_GEMINI_API_KEY || env.EXPO_PUBLIC_GOOGLE_API_KEY);
const openAiDisabled = String(env.EXPO_PUBLIC_AGA_DISABLE_OPENAI || '') === '1';

console.log('[aga:gemini-duplex-check]', {
  engine,
  transport,
  hasGeminiKey: hasKey,
  openAiDisabled,
  liveModel: env.EXPO_PUBLIC_GEMINI_LIVE_MODEL || '(default)',
  textModel: env.EXPO_PUBLIC_GEMINI_TEXT_MODEL || '(default)',
  liveAudioBudgetSeconds: env.EXPO_PUBLIC_AGA_GEMINI_DAILY_LIVE_AUDIO_SECONDS || '900',
});

if (engine !== 'gemini') console.warn('Set EXPO_PUBLIC_AGA_ENGINE=gemini to prevent OpenAI usage.');
if (!hasKey) console.warn('Missing EXPO_PUBLIC_GEMINI_API_KEY or EXPO_PUBLIC_GOOGLE_API_KEY.');
if (!['text', 'live', 'duplex', 'hybrid', 'auto'].includes(transport)) console.warn('Unknown Gemini transport:', transport);
if (transport === 'duplex' || transport === 'hybrid') console.log('Duplex/hybrid will use WebAudio microphone capture where available, otherwise Live/Text fallback.');
console.log('[aga:gemini-duplex-check] wakeless duplex fallback:', env.EXPO_PUBLIC_AGA_GEMINI_WAKELESS_DUPLEX || '1');
if ((transport === 'duplex' || transport === 'hybrid') && String(env.EXPO_PUBLIC_AGA_GEMINI_WAKELESS_DUPLEX || '1') !== '0') {
  console.log('If native/browser speech recognition is missing, AGA can open Gemini duplex as the listening layer. This uses live-audio budget.');
}
if (!openAiDisabled) console.warn('Recommended: EXPO_PUBLIC_AGA_DISABLE_OPENAI=1 while testing Gemini cost control.');
