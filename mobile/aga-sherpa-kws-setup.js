#!/usr/bin/env node
/*
 * AGA Sherpa-ONNX KWS asset setup
 *
 * One script to:
 *  - download the Sherpa-ONNX English KWS model archive
 *  - extract it
 *  - copy/rename low-latency chunk-16-left-64 model files into assets/kws-model
 *  - generate AGA's keywords_raw.txt
 *  - run sherpa-onnx-cli text2token to create keywords.txt
 *  - write a manifest consumed by the AGA Sherpa keyword engine
 *
 * Usage:
 *   node scripts/aga-sherpa-kws-setup.js
 *
 * Optional:
 *   node scripts/aga-sherpa-kws-setup.js --asset-dir ./assets/kws-model --int8
 *   node scripts/aga-sherpa-kws-setup.js --keywords ./aga-kws-phrases.json
 *   node scripts/aga-sherpa-kws-setup.js --skip-pip-install
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawnSync } = require('child_process');

const MODEL_NAME = 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01';
const MODEL_ARCHIVE = `${MODEL_NAME}.tar.bz2`;
const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/${MODEL_ARCHIVE}`;

const DEFAULT_KEYWORDS = [
  // Always-on wake/control set. Keep these conservative.
  { id: 'wake.aga', phrases: ['aga'], boost: 2.5, threshold: 0.22 },
  { id: 'control.stop', phrases: ['stop'], boost: 2.2, threshold: 0.25 },
  { id: 'control.pause', phrases: ['pause'], boost: 2.0, threshold: 0.25 },
  { id: 'control.resume', phrases: ['resume', 'continue'], boost: 1.8, threshold: 0.3 },
  { id: 'control.repeat', phrases: ['repeat', 'repeat options'], boost: 1.7, threshold: 0.3 },
  { id: 'control.back', phrases: ['back', 'go back'], boost: 1.7, threshold: 0.3 },
  { id: 'control.close', phrases: ['close', 'cancel'], boost: 1.7, threshold: 0.3 },

  // Menu selection words. English model only: Indonesian/Russian labels should be handled by STT/GPT or a multilingual KWS model later.
  { id: 'choice.1', phrases: ['one', 'number one', 'option one', 'a', 'letter a'], boost: 1.8, threshold: 0.32 },
  { id: 'choice.2', phrases: ['two', 'number two', 'option two', 'b', 'letter b'], boost: 1.8, threshold: 0.32 },
  { id: 'choice.3', phrases: ['three', 'number three', 'option three', 'c', 'letter c'], boost: 1.8, threshold: 0.32 },
  { id: 'choice.4', phrases: ['four', 'number four', 'option four', 'd', 'letter d'], boost: 1.8, threshold: 0.32 },
  { id: 'choice.5', phrases: ['five', 'number five', 'option five', 'e', 'letter e'], boost: 1.8, threshold: 0.32 },
  { id: 'choice.6', phrases: ['six', 'number six', 'option six', 'f', 'letter f'], boost: 1.8, threshold: 0.32 },

  // Common AGA local menus / modes.
  { id: 'menu.settings', phrases: ['settings', 'settings menu'], boost: 1.7, threshold: 0.32 },
  { id: 'menu.voice', phrases: ['voice menu', 'change voice'], boost: 1.7, threshold: 0.32 },
  { id: 'menu.language', phrases: ['language menu', 'change language'], boost: 1.7, threshold: 0.32 },
  { id: 'mode.guardian', phrases: ['guardian'], boost: 1.5, threshold: 0.35 },
  { id: 'mode.calm', phrases: ['calm'], boost: 1.5, threshold: 0.35 },
  { id: 'mode.whisper', phrases: ['whisper'], boost: 1.5, threshold: 0.35 },
  { id: 'mode.bright', phrases: ['bright'], boost: 1.5, threshold: 0.35 },
  { id: 'skill.breathing', phrases: ['breathing', 'box breathing'], boost: 1.6, threshold: 0.34 },
  { id: 'skill.hypnosis', phrases: ['hypnosis', 'self hypnosis'], boost: 1.6, threshold: 0.34 },
  { id: 'skill.conflict', phrases: ['conflict', 'resolve conflict'], boost: 1.6, threshold: 0.34 },
  { id: 'live.english', phrases: ['practice english', 'english practice'], boost: 1.6, threshold: 0.34 },
];

function parseArgs(argv) {
  const args = {
    assetDir: './assets/kws-model',
    cacheDir: path.join(os.tmpdir(), 'aga-sherpa-kws'),
    keywordsFile: '',
    preferInt8: false,
    skipPipInstall: false,
    force: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--asset-dir') args.assetDir = next();
    else if (arg === '--cache-dir') args.cacheDir = next();
    else if (arg === '--keywords') args.keywordsFile = next();
    else if (arg === '--int8') args.preferInt8 = true;
    else if (arg === '--skip-pip-install') args.skipPipInstall = true;
    else if (arg === '--force') args.force = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`AGA Sherpa-ONNX KWS setup\n\nUsage:\n  node scripts/aga-sherpa-kws-setup.js\n\nOptions:\n  --asset-dir <dir>       Output asset dir. Default: ./assets/kws-model\n  --cache-dir <dir>       Download/extract cache dir. Default: OS temp\n  --keywords <json>       Optional keyword JSON file overriding defaults\n  --int8                  Copy int8 encoder/decoder/joiner instead of fp32\n  --skip-pip-install      Do not run python -m pip install sherpa-onnx\n  --force                 Re-download archive and overwrite asset files\n`);
}

function fail(message) {
  console.error(`\n[aga:sherpa-kws-setup] ERROR: ${message}\n`);
  process.exit(1);
}

function info(message) {
  console.log(`[aga:sherpa-kws-setup] ${message}`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function download(url, outFile, force) {
  if (fs.existsSync(outFile) && !force) {
    info(`archive exists: ${outFile}`);
    return Promise.resolve();
  }
  ensureDir(path.dirname(outFile));
  info(`downloading ${url}`);
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outFile);
    const request = https.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        file.close(() => fs.unlinkSync(outFile));
        download(response.headers.location, outFile, true).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        file.close(() => fs.existsSync(outFile) && fs.unlinkSync(outFile));
        reject(new Error(`HTTP ${response.statusCode} from ${url}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
    });
    request.on('error', (error) => {
      file.close(() => fs.existsSync(outFile) && fs.unlinkSync(outFile));
      reject(error);
    });
  });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options });
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: process.platform === 'win32', ...options });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

function extractArchive(archive, cacheDir, force) {
  const modelDir = path.join(cacheDir, MODEL_NAME);
  if (fs.existsSync(modelDir) && !force) {
    info(`model already extracted: ${modelDir}`);
    return modelDir;
  }
  ensureDir(cacheDir);
  info(`extracting ${archive}`);
  run('tar', ['xvf', archive, '-C', cacheDir]);
  if (!fs.existsSync(modelDir)) fail(`extracted model folder not found: ${modelDir}`);
  return modelDir;
}

function copyFileRequired(src, dst) {
  if (!fs.existsSync(src)) fail(`required model file missing: ${src}`);
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
  info(`copied ${path.basename(src)} -> ${dst}`);
}

function loadKeywords(file) {
  if (!file) return DEFAULT_KEYWORDS;
  const full = path.resolve(file);
  if (!fs.existsSync(full)) fail(`keywords JSON not found: ${full}`);
  const value = JSON.parse(fs.readFileSync(full, 'utf8'));
  if (!Array.isArray(value)) fail('keywords JSON must be an array');
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') fail(`invalid keyword entry at index ${index}`);
    if (!entry.id || !Array.isArray(entry.phrases)) fail(`keyword entry requires id and phrases[] at index ${index}`);
    return {
      id: String(entry.id),
      phrases: entry.phrases.map(String),
      boost: Number.isFinite(Number(entry.boost)) ? Number(entry.boost) : 1.6,
      threshold: Number.isFinite(Number(entry.threshold)) ? Number(entry.threshold) : 0.32,
    };
  });
}

function normalizePhrase(phrase) {
  return String(phrase || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function writeKeywordRaw(keywords, outFile) {
  const lines = [];
  const seen = new Set();
  for (const item of keywords) {
    for (const phrase of item.phrases || []) {
      const clean = normalizePhrase(phrase);
      if (!clean) continue;
      const key = `${clean}|${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`${clean} :${Number(item.boost || 1.6).toFixed(2)} #${Number(item.threshold || 0.32).toFixed(2)} @${item.id}`);
    }
  }
  if (!lines.length) fail('no keyword phrases generated');
  fs.writeFileSync(outFile, `${lines.join('\n')}\n`);
  info(`wrote ${lines.length} raw keyword phrases -> ${outFile}`);
}

function findPython() {
  const candidates = process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python'];
  for (const cmd of candidates) {
    const out = runCapture(cmd, ['--version']);
    if (out) return cmd;
  }
  fail('Python not found. Install Python 3, or run with --skip-pip-install only if sherpa-onnx-cli is already installed.');
}

function commandExists(command) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(probe, [command], { stdio: 'ignore', shell: process.platform === 'win32' });
  return result.status === 0;
}

function ensureSherpaCli(skipPipInstall) {
  if (commandExists('sherpa-onnx-cli')) return;
  if (skipPipInstall) fail('sherpa-onnx-cli not found and --skip-pip-install was set.');
  const python = findPython();
  info('installing/upgrading sherpa-onnx Python package for sherpa-onnx-cli');
  run(python, ['-m', 'pip', 'install', '--upgrade', 'sherpa-onnx']);
  if (!commandExists('sherpa-onnx-cli')) {
    fail('sherpa-onnx-cli still not found after pip install. Check Python Scripts/bin is on PATH.');
  }
}

function generateKeywords(assetDir) {
  const tokens = path.join(assetDir, 'tokens.txt');
  const bpe = path.join(assetDir, 'bpe.model');
  const raw = path.join(assetDir, 'keywords_raw.txt');
  const out = path.join(assetDir, 'keywords.txt');
  if (!fs.existsSync(tokens)) fail(`tokens.txt missing: ${tokens}`);
  if (!fs.existsSync(bpe)) fail(`bpe.model missing: ${bpe}`);
  info('generating keywords.txt with sherpa-onnx-cli text2token');
  run('sherpa-onnx-cli', [
    'text2token',
    '--tokens', tokens,
    '--tokens-type', 'bpe',
    '--bpe-model', bpe,
    raw,
    out,
  ]);
  if (!fs.existsSync(out) || !fs.readFileSync(out, 'utf8').trim()) fail('keywords.txt was not generated');
}

function writeManifest(assetDir, keywords, preferInt8) {
  const manifest = {
    schemaVersion: 1,
    engine: 'sherpa-onnx-kws',
    sourceModel: MODEL_NAME,
    sourceUrl: MODEL_URL,
    precision: preferInt8 ? 'int8' : 'fp32',
    sampleRate: 16000,
    featureDim: 80,
    modelFiles: {
      encoder: 'encoder.onnx',
      decoder: 'decoder.onnx',
      joiner: 'joiner.onnx',
      tokens: 'tokens.txt',
      bpeModel: 'bpe.model',
      keywords: 'keywords.txt',
      rawKeywords: 'keywords_raw.txt',
    },
    runtime: {
      providerAndroid: process.env.EXPO_PUBLIC_AGA_SHERPA_EXECUTION_PROVIDER || 'xnnpack',
      providerWeb: 'wasm',
      numThreads: Number(process.env.EXPO_PUBLIC_AGA_SHERPA_NUM_THREADS || 1),
      maxActivePaths: Number(process.env.EXPO_PUBLIC_AGA_SHERPA_MAX_ACTIVE_PATHS || 4),
      numTrailingBlanks: Number(process.env.EXPO_PUBLIC_AGA_SHERPA_NUM_TRAILING_BLANKS || 1),
    },
    keywordGroups: keywords.map((item) => ({
      id: item.id,
      phrases: item.phrases,
      boost: item.boost,
      threshold: item.threshold,
    })),
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(assetDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  info(`wrote manifest -> ${path.join(assetDir, 'manifest.json')}`);
}

function copyModelFiles(modelDir, assetDir, preferInt8) {
  const suffix = preferInt8 ? 'chunk-16-left-64.int8.onnx' : 'chunk-16-left-64.onnx';
  const prefix = preferInt8 ? 'int8' : 'fp32';
  info(`copying ${prefix} chunk-16-left-64 model files`);
  copyFileRequired(path.join(modelDir, `encoder-epoch-12-avg-2-${suffix}`), path.join(assetDir, 'encoder.onnx'));
  copyFileRequired(path.join(modelDir, `decoder-epoch-12-avg-2-${suffix}`), path.join(assetDir, 'decoder.onnx'));
  copyFileRequired(path.join(modelDir, `joiner-epoch-12-avg-2-${suffix}`), path.join(assetDir, 'joiner.onnx'));
  copyFileRequired(path.join(modelDir, 'tokens.txt'), path.join(assetDir, 'tokens.txt'));
  copyFileRequired(path.join(modelDir, 'bpe.model'), path.join(assetDir, 'bpe.model'));
  if (fs.existsSync(path.join(modelDir, 'configuration.json'))) {
    copyFileRequired(path.join(modelDir, 'configuration.json'), path.join(assetDir, 'configuration.json'));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cacheDir = path.resolve(args.cacheDir);
  const assetDir = path.resolve(args.assetDir);
  const archive = path.join(cacheDir, MODEL_ARCHIVE);

  ensureDir(cacheDir);
  ensureDir(assetDir);

  await download(MODEL_URL, archive, args.force);
  const modelDir = extractArchive(archive, cacheDir, args.force);

  copyModelFiles(modelDir, assetDir, args.preferInt8);

  const keywords = loadKeywords(args.keywordsFile);
  writeKeywordRaw(keywords, path.join(assetDir, 'keywords_raw.txt'));

  ensureSherpaCli(args.skipPipInstall);
  generateKeywords(assetDir);
  writeManifest(assetDir, keywords, args.preferInt8);

  console.log('\n✅ AGA Sherpa KWS assets are ready.\n');
  console.log(`Asset directory: ${assetDir}`);
  console.log('\nRecommended .env values:');
  console.log('EXPO_PUBLIC_AGA_KEYWORD_ENGINE=sherpa');
  console.log('EXPO_PUBLIC_AGA_BROWSER_KEYWORD_ENGINE=sherpa_wasm');
  console.log(`EXPO_PUBLIC_AGA_SHERPA_MODEL_DIR=${path.relative(process.cwd(), assetDir).replace(/\\/g, '/')}`);
  console.log('EXPO_PUBLIC_AGA_DEFAULT_REASONING_PATH=stt_gpt5_tts');
  console.log('EXPO_PUBLIC_AGA_LIVE_SESSION_POLICY=explicit_only');
}

main().catch((error) => fail(error && error.stack ? error.stack : String(error)));
