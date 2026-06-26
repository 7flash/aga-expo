import { buildChoiceMenu, type ChoiceMenu } from './choiceMenus';
import { normalizeSpeech } from './text';

/**
 * Voice-first menu commands are post-wake commands, not wake keywords.
 *
 * Sherpa/short STT should deliver text such as "voice menu", "repeat options",
 * or "close menu" here. Porcupine/Sherpa wake mode should stay limited to
 * fixed hot controls such as AGA, stop, and pause.
 */
export type VoiceMenuCategory =
  | 'main'
  | 'voice'
  | 'personality'
  | 'session'
  | 'language'
  | 'imagination'
  | 'skills'
  | 'listening';

export type VoiceMenuCommand =
  | { type: 'show_menu'; category: VoiceMenuCategory }
  | { type: 'repeat_menu' }
  | { type: 'close_menu' };

type AliasRule = {
  category: VoiceMenuCategory;
  aliases: readonly string[];
};

const MENU_ALIASES: readonly AliasRule[] = [
  {
    category: 'voice',
    aliases: ['voice', 'voices', 'sound', 'speaker', 'change voice', 'select voice', 'suara', 'голос'],
  },
  {
    category: 'language',
    aliases: ['language', 'languages', 'translate', 'translation', 'bahasa', 'english', 'indonesian', 'russian', 'русский', 'язык'],
  },
  {
    category: 'listening',
    aliases: ['listening', 'wake mode', 'sensitivity', 'hands free', 'hands-free', 'barge', 'interrupt', 'hot mic', 'mic sensitivity'],
  },
  {
    category: 'skills',
    aliases: ['skill', 'skills', 'abilities', 'what can you do', 'tools', 'capabilities'],
  },
  {
    category: 'session',
    aliases: ['session', 'guided', 'meditation', 'breathing', 'breathe', 'hypnosis', 'bedtime', 'sleep', 'focus', 'deep work'],
  },
  {
    category: 'personality',
    aliases: ['personality', 'persona', 'style', 'mood', 'character'],
  },
  {
    category: 'imagination',
    aliases: ['imagination', 'imagine', 'world', 'story', 'game', 'adventure'],
  },
  {
    category: 'main',
    aliases: ['settings', 'menu', 'options', 'choices', 'control deck', 'main menu'],
  },
];

const OPEN_WORDS = [
  'open',
  'show',
  'change',
  'choose',
  'select',
  'settings',
  'menu',
  'options',
  'choices',
  'list',
  'pilih',
  'tampilkan',
  'выбери',
  'покажи',
] as const;

function clean(raw: string) {
  return normalizeSpeech(String(raw ?? ''))
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9а-яё'\s-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesPhrase(text: string, phrase: string) {
  const p = clean(phrase);
  if (!p) return false;
  return text === p || text.includes(p);
}

function hasAny(text: string, words: readonly string[]) {
  return words.some((word) => includesPhrase(text, word));
}

function menuCategoryFromText(text: string): VoiceMenuCategory | null {
  for (const rule of MENU_ALIASES) {
    if (hasAny(text, rule.aliases)) return rule.category;
  }
  return null;
}

export function parseVoiceMenuCommand(rawText: string, activeMenu?: ChoiceMenu | null): VoiceMenuCommand | null {
  const text = clean(rawText);
  if (!text) return null;

  if (
    activeMenu?.options?.length &&
    hasAny(text, ['repeat', 'say again', 'again', 'what are the options', 'list options', 'repeat options', 'ulang', 'повтори'])
  ) {
    return { type: 'repeat_menu' };
  }

  if (hasAny(text, ['close menu', 'hide menu', 'cancel menu', 'close options', 'go back', 'back', 'never mind', 'tutup menu', 'назад', 'отмена'])) {
    return { type: 'close_menu' };
  }

  const category = menuCategoryFromText(text);
  const askedForMenu = hasAny(text, OPEN_WORDS) || hasAny(text, ['settings', 'main menu', 'control deck']);

  if (category && (askedForMenu || hasAny(text, ['menu', 'options', 'choices']))) {
    return { type: 'show_menu', category };
  }

  if (askedForMenu) {
    return { type: 'show_menu', category: category ?? 'main' };
  }

  return null;
}

export function menuFromVoiceCommand(command: VoiceMenuCommand): ChoiceMenu | null {
  if (command.type !== 'show_menu') return null;
  return buildChoiceMenu(command.category);
}
