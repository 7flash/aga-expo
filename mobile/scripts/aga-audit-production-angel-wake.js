#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.argv[2] || process.cwd();
function exists(p) { return fs.existsSync(path.join(root, p)); }
function read(p) { try { return fs.readFileSync(path.join(root, p), 'utf8'); } catch { return ''; } }
function ok(message) { console.log(`[aga:prod-angel-audit] OK ${message}`); }
function warn(message) { console.warn(`[aga:prod-angel-audit] WARN ${message}`); }

const required = [
  'src/ui/AgaProductionAngelScreen.tsx',
  'src/ui/HolographicVoicePlatesOverlay.tsx',
  'src/ui/SherpaVerificationLabScreen.tsx',
  'src/ui/SttLabScreen.tsx',
];
for (const file of required) exists(file) ? ok(file) : warn(`missing ${file}`);

const routeCandidates = ['app/index.tsx', 'app/index.web.tsx', 'src/app/index.tsx', 'src/app/index.web.tsx'];
const activeRoutes = routeCandidates.filter(exists);
if (!activeRoutes.length) warn('No Expo Router index route found under app/ or src/app/. If your project uses a custom router, wire AgaProductionAngelScreen manually.');
for (const file of activeRoutes) {
  const body = read(file);
  if (/AgaProductionAngelScreen/.test(body)) ok(`${file} renders AgaProductionAngelScreen`);
  else warn(`${file} does not render AgaProductionAngelScreen`);
}

for (const route of ['app/sherpa-lab.tsx', 'app/stt-lab.tsx', 'app/sst-lab.tsx', 'src/app/sherpa-lab.tsx', 'src/app/stt-lab.tsx', 'src/app/sst-lab.tsx']) {
  if (exists(route)) ok(`route ${route}`);
}

const oldMain = [...activeRoutes, 'src/ui/GuardianPlatesHome.tsx', 'src/ui/EmergencySingleSpineApp.tsx']
  .filter(exists)
  .map(file => [file, read(file)])
  .filter(([_, body]) => /AGA Guardian Console|Simulate Voice Choice|GuardianPlatesHome/.test(body));
if (oldMain.length) warn(`old lab/plates main UI strings still present in: ${oldMain.map(([file]) => file).join(', ')}`);
else ok('old Guardian Console main strings not detected in active routes');

const manifestPath = 'public/sherpa/kws-model/wake_alias_manifest.json';
if (exists(manifestPath)) {
  try {
    const manifest = JSON.parse(read(manifestPath));
    if (manifest.tokenized && !manifest.browserWakeFallback) ok(`Sherpa manifest tokenized; selected trigger: ${manifest.selectedTrigger || '(none)'}`);
    else warn(`Sherpa manifest still fallback: ${manifest.reason || 'unknown reason'}`);
  } catch (e) { warn(`Could not parse ${manifestPath}: ${e.message}`); }
} else warn(`${manifestPath} not found; /sherpa-lab will not be useful until assets are mirrored.`);

console.log('[aga:prod-angel-audit] done');
