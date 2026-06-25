export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeSpeech(text: string) {
  return String(text || '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasWord(text: string, alternatives: string) {
  return new RegExp(`\\b(?:${alternatives})\\b`, 'i').test(normalizeSpeech(text));
}

export function wakeRegex(wakePhrase: string) {
  const aliases = Array.from(new Set([wakePhrase, 'hey aga', 'okay aga', 'ok aga', 'hey angel', 'aga', 'angel']))
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => escapeRegExp(value).replace(/\s+/g, '\\s+'));

  return new RegExp(`\\b(?:${aliases.join('|')})\\b[:,\\s-]*`, 'i');
}

export function removeWakePhrase(text: string, wakePhrase: string) {
  const normalized = normalizeSpeech(text);
  const match = normalized.match(wakeRegex(wakePhrase));
  if (!match || match.index == null) return normalized;
  return normalized.slice(match.index + match[0].length).trim();
}
