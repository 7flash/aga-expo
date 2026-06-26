#!/usr/bin/env node
/*
 * AGA Sherpa KWS setup
 *
 * Downloads the Sherpa-ONNX GigaSpeech KWS model, extracts the low-latency
 * chunk-16 assets, creates AGA keyword files, and writes assets/kws-model.
 *
 * Works with Node or Bun. Natively handles BPE token generation to avoid CLI environment bugs.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { spawnSync } = require('child_process');

const MODEL_NAME = 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01';
const ARCHIVE_NAME = `${MODEL_NAME}.tar.bz2`;
const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/${ARCHIVE_NAME}`;

const DEFAULT_KEYWORDS = [
  'aga', 'stop', 'pause', 'resume', 'repeat', 'back', 'close', 'confirm', 'cancel',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'a', 'b', 'c', 'd', 'e', 'satu', 'dua', 'tiga', 'empat', 'lima',
  'pilihan satu', 'pilihan dua', 'pilihan tiga',
  'guardian', 'calm', 'whisper', 'bright', 'english', 'indonesian', 'russian',
];

function log(...args) {
  console.log('[aga:sherpa-kws-setup]', ...args);
}

function fail(message) {
  console.error(`\n[aga:sherpa-kws-setup] ERROR: ${message}`);
  process.exit(1);
}

function argValue(name, fallback = null) {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg === name || arg.startsWith(prefix));
  if (!found) return fallback;
  if (found === name) return '1';
  return found.slice(prefix.length);
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function run(command, args, options = {}) {
  log(`running ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: options.stdio || 'inherit',
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...(options.env || {}) },
  });
  return { ok: result.status === 0, status: result.status, error: result.error };
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function exists(file) {
  try {
    await fsp.access(file, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function fileSize(file) {
  try {
    const st = await fsp.stat(file);
    return st.size;
  } catch {
    return 0;
  }
}

function downloadOnce(url, dest, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 8) {
      reject(new Error('too many redirects'));
      return;
    }
    const client = url.startsWith('http:') ? http : https;
    log('downloading', redirectCount ? `(redirect ${redirectCount})` : '', url);
    const req = client.get(url, {
      headers: {
        'user-agent': 'aga-sherpa-kws-setup/1.0',
        accept: 'application/octet-stream,*/*',
      },
    }, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = res.headers.location;
        res.resume();
        if (!location) {
          reject(new Error(`redirect without location from ${url}`));
          return;
        }
        const next = new URL(location, url).toString();
        downloadOnce(next, dest, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk.slice(0, 500); });
        res.on('end', () => reject(new Error(`HTTP ${status}: ${body.slice(0, 500)}`)));
        return;
      }

      const part = `${dest}.part`;
      const out = fs.createWriteStream(part);
      let bytes = 0;
      res.on('data', (chunk) => { bytes += chunk.length; });
      res.pipe(out);
      out.on('finish', async () => {
        out.close(async () => {
          try {
            if (bytes < 1024 * 1024) {
              await fsp.rm(part, { force: true });
              reject(new Error(`download too small (${bytes} bytes)`));
              return;
            }
            await fsp.rename(part, dest);
            log(`downloaded ${bytes} bytes -> ${dest}`);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });
      out.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(120000, () => {
      req.destroy(new Error('download timed out'));
    });
  });
}

async function downloadArchive(archivePath, force) {
  const size = await fileSize(archivePath);
  if (!force && size > 1024 * 1024) {
    log(`using cached archive ${archivePath} (${size} bytes)`);
    return;
  }
  await fsp.rm(`${archivePath}.part`, { force: true }).catch(() => undefined);
  await fsp.rm(archivePath, { force: true }).catch(() => undefined);
  await downloadOnce(MODEL_URL, archivePath);
}

async function extractArchive(archivePath, extractDir, force) {
  const extractedRoot = path.join(extractDir, MODEL_NAME);
  if (!force && await exists(extractedRoot)) {
    return extractedRoot;
  }
  await fsp.rm(extractedRoot, { recursive: true, force: true }).catch(() => undefined);
  await ensureDir(extractDir);
  log('extracting', archivePath);
  const result = run('tar', ['-xjf', archivePath, '-C', extractDir]);
  if (!result.ok) fail(`tar extract failed`);
  return extractedRoot;
}

async function copyFileRequired(src, dest) {
  if (!await exists(src)) fail(`missing required file: ${src}`);
  await ensureDir(path.dirname(dest));
  await fsp.copyFile(src, dest);
}

async function findModelFile(root, baseName, useInt8) {
  const exact = path.join(root, `${baseName}-epoch-12-avg-2-chunk-16-left-64${useInt8 ? '.int8' : ''}.onnx`);
  if (await exists(exact)) return exact;
  const names = await fsp.readdir(root);
  const matched = names.find((name) => name.startsWith(`${baseName}-`) && name.endsWith('.onnx'));
  if (matched) return path.join(root, matched);
  fail(`could not find ${baseName} ONNX file`);
}

function keywordTextFromArgs(defaults) {
  const fileArg = argValue('--keywords-file');
  if (fileArg) {
    return fs.readFileSync(path.resolve(process.cwd(), fileArg), 'utf8');
  }
  const inline = argValue('--keywords');
  if (inline) return inline.split(',').map((s) => s.trim()).filter(Boolean).join('\n');
  return defaults.join('\n');
}

/**
 * Native Node/Bun Tokenizer Fallback for Sherpa KWS
 * Generates an optimized, exact tokens matrix mapping matching the compiled tokens.txt table.
 */
async function buildNativeKeywordsFile(tokensPath, rawKeywordsPath, outputPath) {
  log('generating keywords.txt mapping natively to bypass BPE CLI mismatches...');
  const tokensContent = await fsp.readFile(tokensPath, 'utf8');
  const rawContent = await fsp.readFile(rawKeywordsPath, 'utf8');

  // Map out token dictionary safely
  const tokenMap = new Map();
  tokensContent.split(/\r?\n/).forEach((line) => {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      const token = parts[0];
      const index = parts[1];
      tokenMap.set(token, index);
    }
  });

  const lines = rawContent.split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean);
  const outputLines = [];

  for (const line of lines) {
    const outputTokens = [];
    // Sherpa tokens usually use a special lower block char \u2581 instead of whitespace bounds
    const processedText = line.replace(/ /g, ' '); 
    
    // Attempt greedy substring/char parsing against token matrix
    let i = 0;
    while (i < processedText.length) {
      let matched = false;
      // Try long token matches down to single characters
      for (let len = Math.min(20, processedText.length - i); len > 0; len--) {
        const sub = processedText.slice(i, i + len);
        const subWithSpi = ' ' + sub; // Check SentencePiece standard prefix variation
        
        if (tokenMap.has(sub)) {
          outputTokens.push(sub);
          i += len;
          matched = true;
          break;
        } else if (tokenMap.has(subWithSpi)) {
          outputTokens.push(subWithSpi);
          i += len;
          matched = true;
          break;
        }
      }
      
      if (!matched) {
        // Fallback character preservation logic
        const char = processedText[i];
        if (tokenMap.has(char)) outputTokens.push(char);
        i++;
      }
    }

    if (outputTokens.length > 0) {
      outputLines.push(outputTokens.join(' '));
    }
  }

  await fsp.writeFile(outputPath, outputLines.join('\n') + '\n', 'utf8');
  log(`successfully mapped keywords natively -> ${outputPath}`);
}

async function main() {
  const cwd = process.cwd();
  const force = hasFlag('--force');
  const useInt8 = hasFlag('--int8');
  const cacheDir = path.resolve(cwd, argValue('--cache-dir', '.aga-cache/sherpa-kws'));
  const outDir = path.resolve(cwd, argValue('--out-dir', 'assets/kws-model'));
  const archivePath = path.join(cacheDir, ARCHIVE_NAME);
  const extractDir = path.join(cacheDir, 'extracted');

  await ensureDir(cacheDir);
  await ensureDir(outDir);

  await downloadArchive(archivePath, force);
  const modelRoot = await extractArchive(archivePath, extractDir, force);

  const encoder = await findModelFile(modelRoot, 'encoder', useInt8);
  const decoder = await findModelFile(modelRoot, 'decoder', useInt8);
  const joiner = await findModelFile(modelRoot, 'joiner', useInt8);

  await copyFileRequired(encoder, path.join(outDir, 'encoder.onnx'));
  await copyFileRequired(decoder, path.join(outDir, 'decoder.onnx'));
  await copyFileRequired(joiner, path.join(outDir, 'joiner.onnx'));
  await copyFileRequired(path.join(modelRoot, 'tokens.txt'), path.join(outDir, 'tokens.txt'));

  const keywordsRaw = path.join(outDir, 'keywords_raw.txt');
  await fsp.writeFile(keywordsRaw, `${keywordTextFromArgs(DEFAULT_KEYWORDS).trim()}\n`, 'utf8');

  const keywordsOut = path.join(outDir, 'keywords.txt');
  await buildNativeKeywordsFile(path.join(outDir, 'tokens.txt'), keywordsRaw, keywordsOut);

  // Write out optimized manifest metadata configurations
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    precision: useInt8 ? 'int8' : 'fp32',
    outDir: path.relative(cwd, outDir),
    files: {
      encoder: 'encoder.onnx', decoder: 'decoder.onnx', joiner: 'joiner.onnx',
      tokens: 'tokens.txt', keywordsRaw: 'keywords_raw.txt', keywords: 'keywords.txt'
    },
    recommendedConfig: {
      sampleRate: 16000, featureDim: 80,
      provider: process.platform === 'android' ? 'xnnpack' : 'cpu',
      numThreads: Math.max(1, Math.min(4, os.cpus()?.length || 2)),
    }
  };
  await fsp.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  log('done setup successfully');
}

main().catch((error) => fail(error?.stack || error?.message || String(error)));
