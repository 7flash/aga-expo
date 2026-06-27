import type { ChoiceMenu } from '../aga/choiceMenus';

type AnyOption = { key?: string | number; label?: string; title?: string; description?: string };

function clean(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function spokenKey(key: unknown, index: number) {
  const raw = clean(key || index + 1);
  if (/^\d+$/.test(raw)) return `number ${raw}`;
  return raw.toUpperCase();
}

export function compactMenuLine(menu: ChoiceMenu | null | undefined, limit = 6) {
  if (!menu?.options?.length) return '';
  const options = menu.options.slice(0, limit).map((option: AnyOption, index) => {
    const label = clean(option.label || option.title || `Option ${index + 1}`);
    return `${spokenKey(option.key, index)}: ${label}`;
  });
  const extra = menu.options.length > limit ? `, and ${menu.options.length - limit} more` : '';
  return `${clean(menu.title || 'Options')}. ${options.join('; ')}${extra}.`;
}

export function spokenChoicePrompt(menu: ChoiceMenu | null | undefined) {
  const line = compactMenuLine(menu);
  if (!line) return 'Say your command now.';
  return `${line} Say the number, letter, or option name.`;
}

export function selectedChoiceSpeech(label: unknown) {
  const cleanLabel = clean(label || 'that option');
  return `Selected ${cleanLabel}.`;
}