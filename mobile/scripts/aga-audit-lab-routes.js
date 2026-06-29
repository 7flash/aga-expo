#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const root = process.cwd();
const checks = [
  'app/stt-lab.tsx',
  'app/sst-lab.tsx',
  'app/sherpa-lab.tsx',
  'src/app/stt-lab.tsx',
  'src/app/sst-lab.tsx',
  'src/app/sherpa-lab.tsx',
];
let ok = true;
for (const rel of checks) {
  const exists = fs.existsSync(path.join(root, rel));
  console.log(`${exists ? 'OK  ' : 'MISS'} ${rel}`);
  if (!exists && rel.startsWith('app/')) ok = false;
}
if (!ok) process.exitCode = 1;
