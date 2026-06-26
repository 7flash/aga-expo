export type KeywordEngineProvider =
  | 'sherpa_native'
  | 'sherpa_wasm'
  | 'porcupine'
  | 'porcupine_web'
  | 'dev_keyword';

export type KeywordMode = 'wake' | 'menu' | 'command';

export type KeywordIntent =
  | 'wake.aga'
  | 'control.stop'
  | 'control.pause'
  | 'control.resume'
  | 'choice.select'
  | 'menu.repeat'
  | 'menu.back'
  | 'menu.close'
  | 'command.text';

export type KeywordPhrase = {
  id: string;
  intent: KeywordIntent | string;
  phrases: string[];
  value?: string;
  boost?: number;
  threshold?: number;
  metadata?: Record<string, unknown>;
};

export type KeywordEvent = {
  id: string;
  intent: KeywordIntent | string;
  phrase: string;
  value?: string;
  confidence?: number;
  provider: KeywordEngineProvider;
  mode: KeywordMode;
  metadata?: Record<string, unknown>;
};

export type KeywordEngineConfig = {
  mode: KeywordMode;
  keywords: KeywordPhrase[];
  provider?: KeywordEngineProvider | 'sherpa' | 'auto';
  timeoutMs?: number;
  locale?: string;
  allowTextFallback?: boolean;
};

export type KeywordEngineCallbacks = {
  onKeyword: (event: KeywordEvent) => void;
  onText?: (text: string, provider: KeywordEngineProvider) => void;
  onNoMatch?: (reason: string) => void;
  onStatus?: (status: string) => void;
  onError?: (message: string) => void;
};

export interface KeywordEngine {
  start(config: KeywordEngineConfig): Promise<void> | void;
  stop(reason?: string): Promise<void> | void;
  setKeywords?(keywords: KeywordPhrase[]): Promise<void> | void;
  getDiagnostics?(): unknown;
}

export function flattenKeywordPhrases(keywords: KeywordPhrase[]) {
  const out: Array<{ keyword: KeywordPhrase; phrase: string }> = [];
  for (const keyword of keywords) {
    for (const phrase of keyword.phrases || []) {
      const clean = String(phrase || '').trim();
      if (clean) out.push({ keyword, phrase: clean });
    }
  }
  return out;
}

export function matchKeywordText(text: string, keywords: KeywordPhrase[]) {
  const clean = String(text || '').trim().toLowerCase();
  if (!clean) return null;
  const flattened = flattenKeywordPhrases(keywords)
    .map((item) => ({ ...item, normalized: item.phrase.trim().toLowerCase() }))
    .filter((item) => item.normalized);

  // Exact phrase and “choose X” matches first.
  for (const item of flattened) {
    if (clean === item.normalized || clean === `choose ${item.normalized}` || clean === `select ${item.normalized}`) {
      return { keyword: item.keyword, phrase: item.phrase, confidence: 1 };
    }
  }

  // Then contained phrase matches, favoring longer labels so “calm voice” wins over “calm”.
  const contained = flattened
    .filter((item) => clean.includes(item.normalized))
    .sort((a, b) => b.normalized.length - a.normalized.length)[0];
  if (contained) return { keyword: contained.keyword, phrase: contained.phrase, confidence: 0.82 };
  return null;
}
