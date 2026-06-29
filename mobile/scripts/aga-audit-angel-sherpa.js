#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const root = process.argv[2] || process.cwd();
function exists(p){ return fs.existsSync(path.join(root,p)); }
const checks = [
  'src/ui/AgaAngelApplianceScreen.tsx',
  'src/ui/SherpaInteractiveLabScreen.tsx',
  'src/app/index.tsx',
  'src/app/index.web.tsx',
  'src/app/sherpa-lab.tsx',
];
let ok = true;
for (const f of checks) {
  if (!exists(f)) { console.error('[missing]', f); ok=false; }
  else console.log('[ok]', f);
}
const possibleOld = ['src/ui/GuardianPlatesHome.tsx','src/ui/GuardianConsole.tsx'];
for (const f of possibleOld) if (exists(f)) console.log('[note] old lab screen still exists, but / should not import it:', f);
const publicManifest = path.join(root, 'public/sherpa/kws-model/wake_alias_manifest.json');
if (fs.existsSync(publicManifest)) {
  const manifest = JSON.parse(fs.readFileSync(publicManifest,'utf8'));
  console.log('[sherpa manifest]', JSON.stringify({ tokenized: manifest.tokenized, fallback: manifest.browserWakeFallback, selectedTrigger: manifest.selectedTrigger, reason: manifest.reason }));
} else {
  console.warn('[warn] missing public/sherpa/kws-model/wake_alias_manifest.json');
}
process.exit(ok ? 0 : 1);
