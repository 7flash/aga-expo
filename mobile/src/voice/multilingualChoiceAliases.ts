import { normalizeSpeech } from '../aga/text';

export type ChoiceLike = {
  key?: string | number;
  label?: string;
  title?: string;
  description?: string;
  aliases?: string[];
};

const NUMBER_ALIASES: Record<number, string[]> = {
  1: ['1', 'one', 'first', 'number one', 'option one', 'a', 'letter a', 'satu', 'pilihan satu', 'nomor satu', 'один', 'первый', 'первая', 'номер один'],
  2: ['2', 'two', 'second', 'number two', 'option two', 'b', 'letter b', 'dua', 'pilihan dua', 'nomor dua', 'два', 'второй', 'вторая', 'номер два'],
  3: ['3', 'three', 'third', 'number three', 'option three', 'c', 'letter c', 'tiga', 'pilihan tiga', 'nomor tiga', 'три', 'третий', 'третья', 'номер три'],
  4: ['4', 'four', 'fourth', 'number four', 'option four', 'd', 'letter d', 'empat', 'pilihan empat', 'nomor empat', 'четыре', 'четвертый', 'четвертая'],
  5: ['5', 'five', 'fifth', 'number five', 'option five', 'e', 'letter e', 'lima', 'pilihan lima', 'nomor lima', 'пять', 'пятый', 'пятая'],
  6: ['6', 'six', 'sixth', 'number six', 'option six', 'f', 'letter f', 'enam', 'pilihan enam', 'nomor enam', 'шесть', 'шестой', 'шестая'],
  7: ['7', 'seven', 'seventh', 'number seven', 'option seven', 'g', 'letter g', 'tujuh', 'pilihan tujuh', 'nomor tujuh', 'семь', 'седьмой', 'седьмая'],
  8: ['8', 'eight', 'eighth', 'number eight', 'option eight', 'h', 'letter h', 'delapan', 'pilihan delapan', 'nomor delapan', 'восемь', 'восьмой', 'восьмая'],
  9: ['9', 'nine', 'ninth', 'number nine', 'option nine', 'i', 'letter i', 'sembilan', 'pilihan sembilan', 'nomor sembilan', 'девять', 'девятый', 'девятая'],
};

const LETTER_ALIASES = 'abcdefghijklmnopqrstuvwxyz'.split('').reduce<Record<string, string[]>>((acc, letter) => {
  acc[letter] = [letter, `letter ${letter}`, `option ${letter}`, `pilihan ${letter}`];
  return acc;
}, {});

function clean(value: unknown) {
  return normalizeSpeech(String(value ?? '')).toLowerCase().trim();
}

function containsWhole(haystack: string, needle: string) {
  if (!needle) return false;
  if (/^[a-z0-9]$/i.test(needle)) return new RegExp(`(?:^|\\s)${needle}(?:\\s|$)`, 'i').test(haystack);
  return haystack === needle || haystack.includes(needle);
}

function optionTerms(option: ChoiceLike, index: number) {
  const terms = new Set<string>();
  const oneBased = index + 1;
  const key = clean(option.key);
  const label = clean(option.label || option.title);
  const title = clean(option.title);
  const desc = clean(option.description);
  if (key) terms.add(key);
  if (label) terms.add(label);
  if (title) terms.add(title);
  if (desc && desc.length < 48) terms.add(desc);
  for (const alias of option.aliases || []) terms.add(clean(alias));
  for (const alias of NUMBER_ALIASES[oneBased] || []) terms.add(clean(alias));
  const keyLetter = key.length === 1 && /^[a-z]$/.test(key) ? key : String.fromCharCode(96 + oneBased);
  for (const alias of LETTER_ALIASES[keyLetter] || []) terms.add(clean(alias));
  return [...terms].filter(Boolean);
}

export function resolveChoicePhrase(text: string, options: ChoiceLike[] = []) {
  const phrase = clean(text)
    .replace(/^(choose|select|pick|use|go with|ambil|pilih|выбери|выбрать)\s+/i, '')
    .trim();
  if (!phrase || !options.length) return null;
  for (let i = 0; i < options.length; i += 1) {
    const terms = optionTerms(options[i], i);
    if (terms.some((term) => containsWhole(phrase, term))) {
      const option = options[i];
      return {
        index: i,
        key: option.key ?? i + 1,
        label: option.label || option.title || `Option ${i + 1}`,
        spoken: text,
      };
    }
  }
  return null;
}

export function choicePromptHint(options: ChoiceLike[] = []) {
  if (!options.length) return 'Say a number, letter, or option name.';
  const parts = options.slice(0, 6).map((option, index) => `${index + 1}: ${option.label || option.title || option.key || `Option ${index + 1}`}`);
  return `${parts.join('; ')}. Say the number, letter, or name.`;
}
