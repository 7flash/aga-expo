import { flattenKeywordPhrases, type KeywordPhrase } from './keywordEngine';

export type CompiledSherpaKeywords = {
  phrases: string[];
  entries: KeywordPhrase[];
  keywordText: string;
  phraseToId: Record<string, string>;
  digest: string;
};

function normalize(text: string) {
  return String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function simpleDigest(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function sherpaKeywordLine(phrase: string, keyword: KeywordPhrase) {
  const boost = Number.isFinite(keyword.boost as number) ? keyword.boost : 1.0;
  const threshold = Number.isFinite(keyword.threshold as number) ? keyword.threshold : 0.5;
  // sherpa-onnx KWS builds often accept a keyword text file with one entry per line.
  // Tokenized builds can replace this line format inside the native adapter without
  // changing AGA's higher-level keyword API.
  return `${phrase} /${boost}/ #${threshold}`;
}

export function compileSherpaKeywords(keywords: KeywordPhrase[]): CompiledSherpaKeywords {
  const phrases: string[] = [];
  const phraseToId: Record<string, string> = {};
  const lines: string[] = [];

  for (const { keyword, phrase } of flattenKeywordPhrases(keywords)) {
    const clean = normalize(phrase);
    if (!clean || phraseToId[clean]) continue;
    phrases.push(clean);
    phraseToId[clean] = keyword.id;
    lines.push(sherpaKeywordLine(clean, keyword));
  }

  const keywordText = lines.join('
');
  return {
    phrases,
    entries: keywords,
    keywordText,
    phraseToId,
    digest: simpleDigest(keywordText),
  };
}

export function keywordDebugTable(compiled: CompiledSherpaKeywords, limit = 18) {
  const sample = compiled.phrases.slice(0, limit);
  return {
    count: compiled.phrases.length,
    digest: compiled.digest,
    sample,
    truncated: compiled.phrases.length > sample.length,
  };
}