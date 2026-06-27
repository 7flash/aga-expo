export type WakeDetection = {
  woke: boolean;
  kind: 'none' | 'strict' | 'fuzzy_prefix';
  match: string;
  index: number;
};

export function escapeRegExp(value: string) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeSpeech(text: string) {
  const raw = String(text || '');
  const normalized = typeof raw.normalize === 'function' ? raw.normalize('NFKC') : raw;
  return normalized
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[.,!?;:]+/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactSpeech(text: string) {
  return normalizeSpeech(text).toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '');
}

function levenshteinDistance(a: string, b: string) {
  const left = String(a || '');
  const right = String(b || '');
  const rows = left.length + 1;
  const cols = right.length + 1;
  const dp: number[] = [];
  for (let j = 0; j < cols; j += 1) dp[j] = j;
  for (let i = 1; i < rows; i += 1) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j < cols; j += 1) {
      const old = dp[j];
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = old;
    }
  }
  return dp[cols - 1] ?? 99;
}

function envFlag(name: string, fallback: boolean) {
  const raw = (process.env?.[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function fuzzyWakeFromShortUtterance(text: string): { woke: boolean; match: string; index: number } {
  const normalized = normalizeSpeech(text).toLowerCase();
  if (!normalized) return { woke: false, match: '', index: -1 };
  const compact = compactSpeech(normalized);

  const words = normalized.split(/\s+/).filter(Boolean);
  const shortWakeSized = words.length <= 5 && normalized.length <= 42;
  if (!shortWakeSized) return { woke: false, match: '', index: -1 };

  if (/^(?:hey|hi|ok|okay|yo)?(?:aga|agga|agha|aiga|ayga|agar|agaur|egga|eggah|aguy|agay|aijay|aegis|aggy|aggie|aria|aya|eva|ava|google|gugel|gemini)$/i.test(compact)) {
    return { woke: true, match: normalized, index: 0 };
  }
  if (/^(?:hey|hi|ok|okay|yo)?a(?:g|gee|ji|je|jay)a$/i.test(compact)) {
    return { woke: true, match: normalized, index: 0 };
  }
  if (/^(?:hey|hi|ok|okay|yo)?aygee(?:ay|a)$/i.test(compact)) {
    return { woke: true, match: normalized, index: 0 };
  }

  const startIndex = /^(hey|hi|ok|okay|yo)$/i.test(words[0] || '') ? 1 : 0;
  const candidate = words.slice(startIndex, startIndex + 3).join('');
  const cleanedCandidate = candidate.replace(/[^a-z0-9]+/gi, '');
  if (cleanedCandidate && (
    levenshteinDistance(cleanedCandidate, 'aga') <= 2 ||
    /^(a?g+a?|a+g+a+|e+g+a+|a+guy|a+gay|google|gugel|gemini|angel|anger|aggie|aggy|aria|eva|ava)$/i.test(cleanedCandidate)
  )) {
    return { woke: true, match: words.slice(0, startIndex + 3).join(' '), index: 0 };
  }

  if (envFlag('EXPO_PUBLIC_AGA_WAKE_ACCEPT_SHORT_HEY', true) && startIndex === 1 && words.length <= 3) {
    return { woke: true, match: words.join(' '), index: 0 };
  }

  return { woke: false, match: '', index: -1 };
}

export function hasWord(text: string, alternatives: string) {
  return new RegExp(`\\b(?:${alternatives})\\b`, 'i').test(normalizeSpeech(text));
}

function cleanAlias(value: string) {
  return normalizeSpeech(value).toLowerCase();
}

function aliasPattern(value: string) {
  return escapeRegExp(value.trim()).replace(/\s+/g, '\\s+');
}

function strictWakeAliases(wakePhrase: string) {
  const custom = cleanAlias(wakePhrase || 'aga');
  return Array.from(
    new Set([
      custom,
      custom.replace(/^hey\s+/, ''),
      custom.replace(/^ok(?:ay)?\s+/, ''),
      'aga',
      'hey aga',
      'hi aga',
      'ok aga',
      'okay aga',
      'yo aga',
      'dear aga',
      'a g a',
      'agha',
      'agga',
      'ayga',
      'aiga',
      'angel',
      'hey angel',
      'guardian angel',
    ]),
  )
    .map((value) => value.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(aliasPattern);
}

export function wakeRegex(wakePhrase: string) {
  const aliases = strictWakeAliases(wakePhrase);
  return new RegExp(`(?:^|\\b)(?:${aliases.join('|')})(?:\\b|$)[,\\s-]*`, 'i');
}

function fuzzyPrefixWakeRegex(wakePhrase: string) {
  const custom = cleanAlias(wakePhrase || 'aga');
  const customWithoutHey = custom.replace(/^(?:hey|hi|ok|okay)\s+/, '');
  const rawAliases = [
    aliasPattern(custom),
    aliasPattern(customWithoutHey),
    'hey\\s+aga',
    'hi\\s+aga',
    'ok(?:ay)?\\s+aga',
    'aga',
    'agha',
    'agga',
    'agar',
    'ayga',
    'aiga',
    'a\\s*g\\s*a',
    'a\\s+guy',
    'gaga',
    'angel',
    'anger',
  ].filter(Boolean);
  return new RegExp(`^\\s*(?:(?:hey|ok|okay|hi|yo)\\s+)?(?:${rawAliases.join('|')})(?:\\b|$)[,\\s-]*`, 'i');
}

export function detectWake(text: string, wakePhrase: string): WakeDetection {
  const normalized = normalizeSpeech(text);
  if (!normalized) return { woke: false, kind: 'none', match: '', index: -1 };

  const strict = normalized.match(wakeRegex(wakePhrase));
  if (strict && strict.index != null) {
    return { woke: true, kind: 'strict', match: strict[0], index: strict.index };
  }

  const fuzzy = normalized.match(fuzzyPrefixWakeRegex(wakePhrase));
  if (fuzzy && fuzzy.index === 0) {
    return { woke: true, kind: 'fuzzy_prefix', match: fuzzy[0], index: 0 };
  }

  const shortFuzzy = fuzzyWakeFromShortUtterance(normalized);
  if (shortFuzzy.woke) {
    return { woke: true, kind: 'fuzzy_prefix', match: shortFuzzy.match, index: shortFuzzy.index };
  }

  return { woke: false, kind: 'none', match: '', index: -1 };
}

export function removeWakePhrase(text: string, wakePhrase: string) {
  const normalized = normalizeSpeech(text);
  const wake = detectWake(normalized, wakePhrase);
  if (!wake.woke) return normalized;
  return normalized.slice(wake.index + wake.match.length).trim();
}

export function hasWakePrefix(text: string, wakePhrase = 'aga') {
  const wake = detectWake(text, wakePhrase);
  return wake.woke && wake.index <= 3;
}

export function stripWakePrefix(text: string, wakePhrase = 'aga') {
  const normalized = normalizeSpeech(text);
  const wake = detectWake(normalized, wakePhrase);
  if (!wake.woke || wake.index > 3) return normalized;
  return normalized.slice(wake.index + wake.match.length).trim();
}
