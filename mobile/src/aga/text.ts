export type WakeDetection = {
  woke: boolean;
  kind: 'none' | 'strict' | 'fuzzy_prefix';
  match: string;
  index: number;
};

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeSpeech(text: string) {
  return String(text || '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[.,!?;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasWord(text: string, alternatives: string) {
  return new RegExp(`\\b(?:${alternatives})\\b`, 'i').test(normalizeSpeech(text));
}

function strictWakeAliases(wakePhrase: string) {
  return Array.from(
    new Set([
      wakePhrase,
      'hey aga',
      'okay aga',
      'ok aga',
      'hey angel',
      'aga',
      'angel',
    ]),
  )
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => escapeRegExp(value).replace(/\s+/g, '\\s+'));
}

/**
 * Strict wake phrases can match anywhere in the transcript.
 * This is what we trust most for privacy.
 */
export function wakeRegex(wakePhrase: string) {
  const aliases = strictWakeAliases(wakePhrase);
  return new RegExp(`\\b(?:${aliases.join('|')})\\b[:,\\s-]*`, 'i');
}

/**
 * Browser SpeechRecognition often mishears “AGA” as “anger”, “agar”,
 * “a guy”, etc. We only allow these fuzzy forms at the very beginning
 * of a final transcript so AGA does not respond to random background talk.
 */
function fuzzyPrefixWakeRegex(wakePhrase: string) {
  const custom = wakePhrase?.trim() ? escapeRegExp(wakePhrase.trim()).replace(/\s+/g, '\\s+') : '';
  const fuzzyAliases = [
    custom,
    'hey\\s+aga',
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
  return new RegExp(`^\\s*(?:(?:hey|ok|okay|hi)\\s+)?(?:${fuzzyAliases.join('|')})\\b[:,\\s-]*`, 'i');
}

export function detectWake(text: string, wakePhrase: string): WakeDetection {
  const normalized = normalizeSpeech(text);
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
