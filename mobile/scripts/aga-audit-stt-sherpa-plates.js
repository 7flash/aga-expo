#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const required = [
  'src/app/stt-lab.tsx',
  'src/app/sherpa-lab.tsx',
  'src/app/index.tsx',
  'src/ui/SttLabScreen.tsx',
  'src/ui/SherpaLabScreen.tsx',
  'src/ui/GuardianPlatesHome.tsx',
  'src/ai/openaiStt.ts',
  'src/voice/shortUtteranceRecorder.ts',
];
let ok = true;
for (const rel of required) {
  const exists = fs.existsSync(path.join(root, rel));
  console.log(`${exists ? 'OK ' : 'MISS'} ${rel}`);
  if (!exists) ok = false;
}

const stt = path.join(root, 'src/ai/openaiStt.ts');
if (fs.existsSync(stt)) {
  const s = fs.readFileSync(stt, 'utf8');
  if (!s.includes('response.text()')) {
    console.warn('WARN src/ai/openaiStt.ts does not appear to preserve raw error response text.');
  }
  if (/headers:\s*{[^}]*Content-Type/i.test(s)) {
    console.warn('WARN STT fetch sets Content-Type manually. Browser should let FormData set multipart boundary.');
  }
}

process.exit(ok ? 0 : 1);
