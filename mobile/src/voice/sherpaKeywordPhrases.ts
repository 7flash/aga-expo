import type { KeywordPhrase } from './keywordEngine';
import type { ChoiceLike } from './multilingualChoiceAliases';

const CONTROL_STOP = ['stop', 'quiet', 'cancel', 'shush', 'hush', 'berhenti', 'стоп'];
const CONTROL_PAUSE = ['pause', 'hold', 'jeda', 'пауза'];
const CONTROL_RESUME = ['resume', 'continue', 'unpause', 'lanjut', 'продолжить'];

const NUMBER_ALIASES: Record<number, string[]> = {
  1: ['one', 'number one', 'option one', 'first', 'satu', 'pilihan satu', 'один', 'первый'],
  2: ['two', 'number two', 'option two', 'second', 'dua', 'pilihan dua', 'два', 'второй'],
  3: ['three', 'number three', 'option three', 'third', 'tiga', 'pilihan tiga', 'три', 'третий'],
  4: ['four', 'number four', 'option four', 'fourth', 'empat', 'pilihan empat', 'четыре', 'четвёртый'],
  5: ['five', 'number five', 'option five', 'fifth', 'lima', 'pilihan lima', 'пять', 'пятый'],
  6: ['six', 'number six', 'option six', 'sixth', 'enam', 'pilihan enam', 'шесть', 'шестой'],
  7: ['seven', 'number seven', 'option seven', 'seventh', 'tujuh', 'pilihan tujuh', 'семь', 'седьмой'],
  8: ['eight', 'number eight', 'option eight', 'eighth', 'delapan', 'pilihan delapan', 'восемь', 'восьмой'],
  9: ['nine', 'number nine', 'option nine', 'ninth', 'sembilan', 'pilihan sembilan', 'девять', 'девятый'],
};

const LETTERS = 'abcdefghi'.split('');

function uniq(values: string[]) {
  return Array.from(new Set(values.map((v) => String(v || '').trim()).filter(Boolean)));
}

export function wakeKeywords(): KeywordPhrase[] {
  return [
    { id: 'wake.aga', intent: 'wake.aga', phrases: ['aga'], value: 'aga', boost: 2.0, threshold: 0.45 },
    { id: 'control.stop', intent: 'control.stop', phrases: CONTROL_STOP, value: 'stop', boost: 2.0, threshold: 0.4 },
    { id: 'control.pause', intent: 'control.pause', phrases: CONTROL_PAUSE, value: 'pause', boost: 1.6, threshold: 0.45 },
  ];
}

export function baseCommandKeywords(): KeywordPhrase[] {
  return [
    ...wakeKeywords(),
    { id: 'control.resume', intent: 'control.resume', phrases: CONTROL_RESUME, value: 'resume', boost: 1.4, threshold: 0.5 },
    { id: 'menu.repeat', intent: 'menu.repeat', phrases: ['repeat', 'repeat options', 'say options', 'list options', 'ulang', 'повтори'], value: 'repeat' },
    { id: 'menu.back', intent: 'menu.back', phrases: ['back', 'go back', 'previous', 'kembali', 'назад'], value: 'back' },
    { id: 'menu.close', intent: 'menu.close', phrases: ['close', 'close menu', 'cancel menu', 'done', 'tutup', 'закрыть'], value: 'close' },
    { id: 'command.voice_menu', intent: 'command.text', phrases: ['voice menu', 'change voice', 'voices'], value: 'voice menu' },
    { id: 'command.language_menu', intent: 'command.text', phrases: ['language menu', 'change language', 'languages'], value: 'language menu' },
    { id: 'command.settings', intent: 'command.text', phrases: ['settings', 'open settings', 'main menu'], value: 'settings' },
  ];
}

export function choiceKeywords(choices: ChoiceLike[] = []): KeywordPhrase[] {
  const keywords: KeywordPhrase[] = [];
  choices.forEach((choice, index) => {
    const number = index + 1;
    const key = String((choice as any).key ?? number).trim();
    const label = String((choice as any).label || (choice as any).title || `option ${number}`).trim();
    const aliases = Array.isArray((choice as any).aliases) ? (choice as any).aliases.map(String) : [];
    const letter = LETTERS[index];
    const phrases = uniq([
      key,
      label,
      ...aliases,
      ...(NUMBER_ALIASES[number] || []),
      letter,
      `letter ${letter}`,
      `option ${letter}`,
      `choice ${letter}`,
    ]);
    keywords.push({
      id: `choice.${key || number}`,
      intent: 'choice.select',
      phrases,
      value: key || String(number),
      boost: 1.8,
      threshold: 0.48,
      metadata: { index, key, label },
    });
  });
  return keywords;
}

export function postWakeKeywords(choices: ChoiceLike[] = []) {
  return [...baseCommandKeywords(), ...choiceKeywords(choices)];
}
