export type WakePhraseGroup = {
  id: 'aga' | 'stop' | 'pause';
  phrases: string[];
};

export const WAKE_PHRASE_GROUPS: WakePhraseGroup[] = [
  {
    id: 'aga',
    phrases: [
      'aga',
      'ahga',
      'agga',
      'a ga',
      'hey aga',
      'okay aga',
      'ok aga',
      'hello aga',
      'wake aga',
      'guardian',
      'angel',
    ],
  },
  {
    id: 'stop',
    phrases: [
      'stop',
      'cancel',
      'abort',
      'quiet',
    ],
  },
  {
    id: 'pause',
    phrases: [
      'pause',
      'wait',
      'hold',
    ],
  },
];

export function allWakePhrases() {
  return WAKE_PHRASE_GROUPS.flatMap((group) => group.phrases);
}

export function canonicalWakePhrase(text: string) {
  const clean = String(text || '').toLowerCase().trim();

  for (const group of WAKE_PHRASE_GROUPS) {
    if (group.phrases.some((phrase) => clean === phrase || clean.includes(phrase))) {
      return group.id;
    }
  }

  if (clean.includes('aga') || clean.includes('guardian') || clean.includes('angel')) return 'aga';
  if (clean.includes('stop') || clean.includes('cancel') || clean.includes('abort')) return 'stop';
  if (clean.includes('pause') || clean.includes('wait') || clean.includes('hold')) return 'pause';

  return clean;
}

export function wakePhraseHint() {
  return 'Say AGA, hey AGA, guardian, or angel.';
}
