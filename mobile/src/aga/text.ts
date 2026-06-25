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

export function hasWord(text: string, alternatives: string) {
  return new RegExp(`\\b(?:${alternatives})\\b`, 'i').test(normalizeSpeech(text));
}

function cleanAlias(value: string) {
  return normalizeSpeech(value).toLowerCase();
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
    .map((value) => escapeRegExp(value).replace(/\s+/g, '\\s+'));
}

/**
 * Strict wake phrases may match anywhere in the transcript. This catches
 * Android/Web speech engines that prepend filler words before "hey AGA".
 */
export function wakeRegex(wakePhrase: string) {
  const aliases = strictWakeAliases(wakePhrase);
  return new RegExp(`(?:^|\\b)(?:${aliases.join('|')})(?:\\b|$)[,\\s-]*`, 'i');
}

/**
 * Fuzzy wake is only accepted at the beginning so random room speech does not
 * wake AGA. These cover common STT mishearings of "AGA".
 */
function fuzzyPrefixWakeRegex(wakePhrase: string) {
  const custom = cleanAlias(wakePhrase || 'aga');
  const customWithoutHey = custom.replace(/^(?:hey|hi|ok|okay)\s+/, '');
  const fuzzyAliases = [
    custom,
    customWithoutHey,
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
  ]
    .filter(Boolean)
    .map((value) => typeof value === 'string' && value.includes('\\') ? value : escapeRegExp(String(value)).replace(/\s+/g, '\\s+'));
  return new RegExp(`^\\s*(?:(?:hey|ok|okay|hi|yo)\\s+)?(?:${fuzzyAliases.join('|')})(?:\\b|$)[,\\s-]*`, 'i');
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
