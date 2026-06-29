#!/usr/bin/env node
/*
 * Generates a tokenized Sherpa KWS keywords.txt instead of letting the browser
 * silently fall back to volume wake. This script is intentionally conservative:
 * if text2token fails or produces an empty/raw file, it exits non-zero.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const write = args.has('--write') || args.has('-w');
const nativeDir = path.join(root, 'assets', 'kws-model');
const webDir = path.join(root, 'public', 'sherpa', 'kws-model');

function log(msg) { console.log(`[aga:sherpa-keywords] ${msg}`); }
function fail(msg) { console.error(`[aga:sherpa-keywords] ERROR: ${msg}`); process.exit(1); }
function exists(p) { return fs.existsSync(p); }
function read(p) { return fs.readFileSync(p, 'utf8'); }
function writeFile(p, text) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
function copyFile(src, dest) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest); }

function findCli() {
  if (process.env.SHERPA_ONNX_CLI && exists(process.env.SHERPA_ONNX_CLI)) return process.env.SHERPA_ONNX_CLI;
  const localBins = [
    path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'sherpa-onnx-cli.cmd' : 'sherpa-onnx-cli'),
    path.join(root, 'build', 'bin', process.platform === 'win32' ? 'sherpa-onnx-cli.exe' : 'sherpa-onnx-cli'),
  ];
  for (const p of localBins) if (exists(p)) return p;
  return 'sherpa-onnx-cli';
}

function run(command, commandArgs) {
  log(`$ ${[command, ...commandArgs].join(' ')}`);
  const result = cp.spawnSync(command, commandArgs, {
    cwd: root,
    shell: process.platform === 'win32',
    encoding: 'utf8',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

function assertAssets(dir) {
  const required = ['encoder.onnx', 'decoder.onnx', 'joiner.onnx', 'tokens.txt', 'bpe.model'];
  const missing = required.filter((f) => !exists(path.join(dir, f)));
  if (missing.length) {
    fail(`Missing Sherpa model assets in ${path.relative(root, dir)}: ${missing.join(', ')}. Run your Sherpa model setup first.`);
  }
}

function looksTokenized(text) {
  const clean = String(text || '').trim();
  if (!clean) return false;
  // Raw file format is HUMAN TEXT @LABEL. Tokenized BPE usually contains sentencepiece tokens like ▁HEY.
  if (/^[A-Z\s]+\s+@/m.test(clean) && !/[▁]/.test(clean)) return false;
  if (/text2token did not create output/i.test(clean)) return false;
  return /@/.test(clean) || /▁|<blk>|<unk>|[A-Z]\s+[A-Z]/.test(clean);
}

function makeRawKeywords() {
  // Avoid relying only on the brand acronym AGA. English KWS models usually do better
  // with normal spoken phrases. All wake variants map back to @aga.
  return [
    'HEY GUARDIAN @aga',
    'HELLO GUARDIAN @aga',
    'OK GUARDIAN @aga',
    'WAKE GUARDIAN @aga',
    'HEY ANGEL @aga',
    'HELLO ANGEL @aga',
    'OK ANGEL @aga',
    'STOP @stop',
    'CANCEL @stop',
    'QUIET @stop',
    'PAUSE @pause',
    'WAIT @pause',
    'HOLD @pause',
  ].join('\n') + '\n';
}

function writeManifest({ tokenized, reason, selectedCanonical = 'aga', selectedTrigger = 'HEY GUARDIAN' }) {
  const manifest = {
    generatedAt: new Date().toISOString(),
    tokenized,
    browserWakeFallback: !tokenized,
    selectedCanonical,
    selectedTrigger,
    reason,
    groups: [
      { id: 'aga', phrases: ['hey guardian', 'hello guardian', 'ok guardian', 'wake guardian', 'hey angel', 'hello angel', 'ok angel'] },
      { id: 'stop', phrases: ['stop', 'cancel', 'quiet'] },
      { id: 'pause', phrases: ['pause', 'wait', 'hold'] },
    ],
    nativeKeywords: 'assets/kws-model/keywords.txt',
    webKeywords: 'public/sherpa/kws-model/keywords.txt',
  };
  const json = JSON.stringify(manifest, null, 2) + '\n';
  writeFile(path.join(nativeDir, 'wake_alias_manifest.json'), json);
  writeFile(path.join(webDir, 'wake_alias_manifest.json'), json);
}

function main() {
  assertAssets(nativeDir);
  const rawPath = path.join(nativeDir, 'keywords_raw.txt');
  const outPath = path.join(nativeDir, 'keywords.txt');
  const tokensPath = path.join(nativeDir, 'tokens.txt');
  const bpePath = path.join(nativeDir, 'bpe.model');

  const raw = makeRawKeywords();
  log('Raw keyword candidates:');
  console.log(raw);

  if (!write) {
    log('Dry run only. Re-run with --write to generate keywords.txt.');
    return;
  }

  writeFile(rawPath, raw);

  const cli = findCli();
  const result = run(cli, [
    'text2token',
    '--tokens', tokensPath,
    '--tokens-type', 'bpe',
    '--bpe-model', bpePath,
    rawPath,
    outPath,
  ]);

  if (result.status !== 0) {
    writeManifest({ tokenized: false, reason: `text2token failed with exit code ${result.status}` });
    fail(`text2token failed. Install/locate sherpa-onnx-cli or verify tokens.txt + bpe.model match this model.`);
  }

  if (!exists(outPath)) {
    writeManifest({ tokenized: false, reason: 'text2token did not create output' });
    fail('text2token did not create keywords.txt');
  }

  const tokenized = read(outPath);
  if (!looksTokenized(tokenized)) {
    writeManifest({ tokenized: false, reason: 'text2token output is empty or still raw' });
    console.log('--- keywords.txt produced ---');
    console.log(tokenized || '(empty)');
    fail('keywords.txt is not valid tokenized Sherpa KWS input. Try a different English KWS model or longer/common wake phrases.');
  }

  fs.mkdirSync(webDir, { recursive: true });
  copyFile(rawPath, path.join(webDir, 'keywords_raw.txt'));
  copyFile(outPath, path.join(webDir, 'keywords.txt'));
  for (const f of ['encoder.onnx', 'decoder.onnx', 'joiner.onnx', 'tokens.txt', 'bpe.model', 'manifest.json']) {
    const src = path.join(nativeDir, f);
    if (exists(src)) copyFile(src, path.join(webDir, f));
  }
  writeManifest({ tokenized: true, reason: 'text2token succeeded' });

  log('Sherpa keywords generated successfully. Preview:');
  console.log(read(outPath).split('\n').slice(0, 20).join('\n'));
  log('Restart Expo with cache clear: npx expo start -c --web');
}

main();
