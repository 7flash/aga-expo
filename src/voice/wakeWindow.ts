export const DEFAULT_WAKE_PHRASES = ['hey aga', 'okay aga', 'aga', 'angel'];
export const ACTIVE_WINDOW_MS = 35_000;

export function extractWakeCommand(text: string, wakePhrases = DEFAULT_WAKE_PHRASES) {
  const normalized = text.trim();
  const lower = normalized.toLowerCase();
  for (const phrase of wakePhrases) {
    const index = lower.indexOf(phrase.toLowerCase());
    if (index >= 0) {
      return {
        woke: true,
        phrase,
        command: normalized.slice(index + phrase.length).replace(/^[,\s]+/, '').trim(),
      };
    }
  }
  return { woke: false, phrase: null, command: normalized };
}

export function isActiveWindow(activeUntil: number) {
  return Date.now() < activeUntil;
}

export function extendActiveWindow() {
  return Date.now() + ACTIVE_WINDOW_MS;
}
