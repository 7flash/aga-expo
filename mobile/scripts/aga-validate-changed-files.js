#!/usr/bin/env node
/*
 * Fast syntax guard for hand-applied AGA ZIP batches.
 *
 * Usage from repo root:
 *   node scripts/aga-validate-changed-files.js src/aga/WakeRealtimeController.ts src/voice/tts.ts
 *
 * With no args, it checks every TS/TSX/JS/JSX file staged in git. It intentionally
 * uses TypeScript transpile diagnostics only, so it catches parser/bundler blockers
 * without requiring the whole mobile dependency graph to be installed.
 */
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const EXT = /\.(tsx?|jsx?)$/i;

function gitChangedFiles() {
  try {
    const out = cp.execFileSync('git', ['diff', '--name-only', '--cached', '--diff-filter=ACMR'], { encoding: 'utf8' });
    return out.split(/\r?\n/).filter(Boolean).filter((file) => EXT.test(file));
  } catch (_) {
    return [];
  }
}

function formatDiagnostic(diag, file) {
  const pos = diag.file && typeof diag.start === 'number'
    ? diag.file.getLineAndCharacterOfPosition(diag.start)
    : null;
  const where = pos ? `${file}:${pos.line + 1}:${pos.character + 1}` : file;
  const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
  return `${where} ${message}`;
}

const files = (process.argv.slice(2).length ? process.argv.slice(2) : gitChangedFiles())
  .filter((file) => EXT.test(file))
  .filter((file) => fs.existsSync(file));

if (!files.length) {
  console.log('[aga:validate] no changed TS/JS files to syntax-check');
  process.exit(0);
}

let failed = false;
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const ext = path.extname(file).toLowerCase();
  const scriptKind = ext === '.tsx' ? ts.ScriptKind.TSX
    : ext === '.ts' ? ts.ScriptKind.TS
    : ext === '.jsx' ? ts.ScriptKind.JSX
    : ts.ScriptKind.JS;
  const result = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      isolatedModules: true,
      allowJs: true,
    },
    reportDiagnostics: true,
    transformers: undefined,
    compilerHost: undefined,
  });
  const diagnostics = (result.diagnostics || []).filter((diag) => diag.category === ts.DiagnosticCategory.Error);
  if (diagnostics.length) {
    failed = true;
    console.error(`[aga:validate] FAIL ${file}`);
    for (const diag of diagnostics) console.error(`  ${formatDiagnostic(diag, file)}`);
  } else {
    console.log(`[aga:validate] OK ${file}`);
  }
}

if (failed) process.exit(1);
console.log(`[aga:validate] checked ${files.length} file(s), 0 syntax errors`);
