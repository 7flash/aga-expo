import { getRemoteSkills } from '../remote/config';

export type SessionKind =
  | 'language'
  | 'imagination'
  | 'advice'
  | 'focus'
  | 'bedtime'
  | 'breathing'
  | 'music'
  | 'general'
  | 'remote';

export type ChoiceAction =
  | { type: 'show_menu'; menu: 'main' | 'voice' | 'personality' | 'session' | 'language' | 'imagination' | 'skills' | 'focus' | 'bedtime' | 'listening' }
  | { type: 'set_voice'; voice: string; label: string }
  | { type: 'set_persona'; persona: string; label: string }
  | { type: 'regenerate_personality'; style: string; label: string }
  | { type: 'start_session'; kind: SessionKind; label: string; targetLanguage?: string; theme?: string }
  | { type: 'start_remote_skill'; skillId: string; label: string; instructions: string; targetLanguage?: string | null; theme?: string | null; iconUrl?: string | null; imageUrl?: string | null; toolNames?: string[] }
  | { type: 'end_session' }
  | { type: 'set_listening_mode'; mode: 'strict' | 'answer_window' | 'handsfree'; label: string; allowBargeIn?: boolean };

export type ChoiceOption = {
  key: string;
  label: string;
  description?: string;
  aliases?: string[];
  action: ChoiceAction;
};

export type ChoiceMenu = {
  id: string;
  title: string;
  subtitle?: string;
  options: ChoiceOption[];
  createdAt: string;
};

const nowIso = () => new Date().toISOString();

function menu(id: string, title: string, subtitle: string, options: ChoiceOption[]): ChoiceMenu {
  return { id, title, subtitle, options, createdAt: nowIso() };
}

function keyFor(index: number) {
  return String(index + 1);
}

function remoteSkillOptions(): ChoiceOption[] {
  return getRemoteSkills().map((skill, index) => ({
    key: keyFor(index),
    label: skill.label,
    description: skill.description || 'server skill',
    aliases: [skill.id, skill.label, ...(skill.aliases ?? [])],
    action: {
      type: 'start_remote_skill',
      skillId: skill.id,
      label: skill.label,
      instructions: skill.instructions,
      targetLanguage: skill.targetLanguage ?? null,
      theme: skill.theme ?? null,
      iconUrl: skill.iconUrl ?? null,
      imageUrl: skill.imageUrl ?? null,
      toolNames: skill.toolNames ?? [],
    },
  }));
}

function renumber(options: ChoiceOption[], offset: number) {
  return options.map((option, index) => ({ ...option, key: keyFor(offset + index) }));
}

export function buildChoiceMenu(kind: string | null | undefined): ChoiceMenu {
  const normalized = String(kind ?? 'main').toLowerCase().trim();

  if (normalized === 'voice') {
    return menu('voice', 'Choose AGA voice', 'Say the number, letter, or name. Example: “two” or “Cedar”.', [
      { key: '1', label: 'Marin', description: 'soft, warm, close', aliases: ['marin', 'marine'], action: { type: 'set_voice', voice: 'marin', label: 'Marin' } },
      { key: '2', label: 'Cedar', description: 'grounded and clear', aliases: ['cedar', 'seeder'], action: { type: 'set_voice', voice: 'cedar', label: 'Cedar' } },
      { key: '3', label: 'Alloy', description: 'balanced and neutral', aliases: ['alloy', 'ally'], action: { type: 'set_voice', voice: 'alloy', label: 'Alloy' } },
      { key: '4', label: 'Shimmer', description: 'bright and airy', aliases: ['shimmer'], action: { type: 'set_voice', voice: 'shimmer', label: 'Shimmer' } },
      { key: '5', label: 'Verse', description: 'expressive storyteller', aliases: ['verse'], action: { type: 'set_voice', voice: 'verse', label: 'Verse' } },
    ]);
  }

  if (normalized === 'personality') {
    return menu('personality', 'Choose personality', 'Say a number, letter, or “regenerate”.', [
      { key: '1', label: 'Warm guardian', description: 'kind, protective, concise', aliases: ['warm', 'guardian'], action: { type: 'set_persona', persona: 'warm', label: 'Warm guardian' } },
      { key: '2', label: 'Calm guide', description: 'slow, peaceful, grounding', aliases: ['calm', 'guide'], action: { type: 'set_persona', persona: 'calm', label: 'Calm guide' } },
      { key: '3', label: 'Bright friend', description: 'playful and encouraging', aliases: ['bright', 'friend'], action: { type: 'set_persona', persona: 'bright', label: 'Bright friend' } },
      { key: '4', label: 'Focus coach', description: 'direct, clear, action-oriented', aliases: ['focus', 'coach'], action: { type: 'set_persona', persona: 'coach', label: 'Focus coach' } },
      { key: '5', label: 'Regenerate for me', description: 'AGA creates a fresh personality blend', aliases: ['regenerate', 'new personality', 'fresh'], action: { type: 'regenerate_personality', style: 'fresh guardian blend', label: 'Regenerated personality' } },
    ]);
  }

  if (normalized === 'language') {
    return menu('language', 'Language learning session', 'Choose a practice mode by voice.', [
      { key: '1', label: 'English conversation', description: 'gentle speaking practice', aliases: ['english'], action: { type: 'start_session', kind: 'language', label: 'English conversation practice', targetLanguage: 'English', theme: 'conversation' } },
      { key: '2', label: 'Indonesian conversation', description: 'Bahasa practice with corrections', aliases: ['indonesian', 'bahasa'], action: { type: 'start_session', kind: 'language', label: 'Indonesian conversation practice', targetLanguage: 'Indonesian', theme: 'conversation' } },
      { key: '3', label: 'Russian basics', description: 'simple phrases and pronunciation', aliases: ['russian', 'русский'], action: { type: 'start_session', kind: 'language', label: 'Russian basics', targetLanguage: 'Russian', theme: 'basics' } },
      { key: '4', label: 'Roleplay travel', description: 'airport, cafe, directions', aliases: ['travel', 'roleplay'], action: { type: 'start_session', kind: 'language', label: 'Travel roleplay', targetLanguage: 'English', theme: 'travel' } },
    ]);
  }

  if (normalized === 'imagination') {
    return menu('imagination', 'Imagination game', 'Choose a world. AGA narrates and you answer by voice.', [
      { key: '1', label: 'Crystal forest', description: 'calm magical exploration', aliases: ['crystal', 'forest'], action: { type: 'start_session', kind: 'imagination', label: 'Crystal forest imagination game', theme: 'crystal forest' } },
      { key: '2', label: 'Space guardian', description: 'gentle sci-fi mission', aliases: ['space', 'guardian'], action: { type: 'start_session', kind: 'imagination', label: 'Space guardian imagination game', theme: 'space guardian' } },
      { key: '3', label: 'Tiny kingdom', description: 'cozy fantasy story', aliases: ['tiny', 'kingdom'], action: { type: 'start_session', kind: 'imagination', label: 'Tiny kingdom imagination game', theme: 'tiny kingdom' } },
    ]);
  }

  if (normalized === 'listening' || normalized === 'sensitivity' || normalized === 'hot mic' || normalized === 'hot-mic') {
    return menu('listening', 'Choose listening mode', 'Say the number, letter, or mode name.', [
      { key: '1', label: 'Guardian wake mode', description: 'Safest. Responds to AGA or short answers after questions.', aliases: ['strict', 'guardian', 'wake', 'wake word'], action: { type: 'set_listening_mode', mode: 'strict', label: 'Guardian wake mode', allowBargeIn: false } },
      { key: '2', label: 'Question window mode', description: 'Allows brief answers after AGA asks you something.', aliases: ['question', 'answer', 'window'], action: { type: 'set_listening_mode', mode: 'answer_window', label: 'Question window mode', allowBargeIn: false } },
      { key: '3', label: 'Hands-free session', description: 'Natural conversation until the session sleeps.', aliases: ['hands free', 'hands-free', 'conversation', 'natural'], action: { type: 'set_listening_mode', mode: 'handsfree', label: 'Hands-free session', allowBargeIn: false } },
      { key: '4', label: 'Allow interruptions', description: 'AGA can be interrupted when you begin speaking.', aliases: ['interrupt', 'barge in', 'barge-in'], action: { type: 'set_listening_mode', mode: 'answer_window', label: 'Question window with interruptions', allowBargeIn: true } },
      { key: '5', label: 'Block interruptions', description: 'Background laughter or speech will not cut AGA off.', aliases: ['no interrupt', 'block', 'quiet background'], action: { type: 'set_listening_mode', mode: 'strict', label: 'Guardian wake mode', allowBargeIn: false } },
    ]);
  }

  if (normalized === 'skills' || normalized === 'session') {
    const remote = remoteSkillOptions();
    const builtins = [
      { key: '1', label: 'Language learning', description: 'practice with corrections', aliases: ['language', 'learn'], action: { type: 'show_menu', menu: 'language' } as ChoiceAction },
      { key: '2', label: 'Imagination game', description: 'voice-only story play', aliases: ['imagination', 'adventure', 'game'], action: { type: 'show_menu', menu: 'imagination' } as ChoiceAction },
      { key: '3', label: 'Calm advice', description: 'short supportive guidance', aliases: ['advice', 'calm'], action: { type: 'start_session', kind: 'advice', label: 'Calm advice session', theme: 'calm advice' } as ChoiceAction },
      { key: '4', label: 'Focus coach', description: 'choose one task and begin', aliases: ['focus', 'coach', 'work'], action: { type: 'start_session', kind: 'focus', label: 'Focus coaching session', theme: 'deep work' } as ChoiceAction },
      { key: '5', label: 'Breathing guide', description: 'slow nervous-system reset', aliases: ['breathing', 'breathe'], action: { type: 'start_session', kind: 'breathing', label: 'Breathing guide', theme: 'breathing' } as ChoiceAction },
      { key: '6', label: 'Bedtime story', description: 'soft sleep-friendly narration', aliases: ['bedtime', 'story', 'sleep'], action: { type: 'start_session', kind: 'bedtime', label: 'Bedtime story session', theme: 'sleep story' } as ChoiceAction },
      { key: '7', label: 'Music companion', description: 'ambient music plus quiet conversation', aliases: ['music', 'ambient'], action: { type: 'start_session', kind: 'music', label: 'Music companion session', theme: 'ambient music' } as ChoiceAction },
      { key: '8', label: 'General guardian', description: 'normal AGA mode', aliases: ['general', 'normal'], action: { type: 'start_session', kind: 'general', label: 'General guardian session' } as ChoiceAction },
    ];
    return menu('skills', remote.length ? 'Choose a server skill or built-in skill' : 'Choose a skill', 'Say a number or skill name. Server skills can be edited remotely.', [
      ...remote,
      ...renumber(builtins, remote.length),
    ]);
  }

  return menu('main', 'AGA settings', 'No buttons. Say a number, letter, or option name.', [
    { key: 'A', label: 'Change voice', description: 'choose a Realtime voice', aliases: ['voice'], action: { type: 'show_menu', menu: 'voice' } },
    { key: 'B', label: 'Change personality', description: 'warm, calm, bright, coach, or regenerate', aliases: ['personality'], action: { type: 'show_menu', menu: 'personality' } },
    { key: 'C', label: 'Choose a skill', description: 'server skills, language, game, focus, bedtime, breathing', aliases: ['skill', 'skills'], action: { type: 'show_menu', menu: 'skills' } },
    { key: 'D', label: 'Start language learning', description: 'practice a language by voice', aliases: ['language'], action: { type: 'show_menu', menu: 'language' } },
    { key: 'E', label: 'Play imagination game', description: 'a guided voice story', aliases: ['imagination', 'game'], action: { type: 'show_menu', menu: 'imagination' } },
    { key: 'F', label: 'Listening sensitivity', description: 'wake word, answer windows, or hands-free session', aliases: ['listening', 'sensitivity', 'hot mic', 'wake'], action: { type: 'show_menu', menu: 'listening' } },
  ]);
}

const WORD_NUMBERS: Record<string, string> = {
  one: '1', first: '1', won: '1',
  two: '2', second: '2', to: '2', too: '2',
  three: '3', third: '3', tree: '3',
  four: '4', fourth: '4', for: '4',
  five: '5', fifth: '5',
  six: '6', sixth: '6',
  seven: '7', seventh: '7',
  eight: '8', eighth: '8', ate: '8',
  nine: '9', ninth: '9', ten: '10', tenth: '10',
  satu: '1', dua: '2', tiga: '3', empat: '4', lima: '5', enam: '6', tujuh: '7', delapan: '8', sembilan: '9', sepuluh: '10',
  uno: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9', diez: '10',
  odin: '1', один: '1', pervyy: '1', первый: '1',
  dva: '2', два: '2', vtoroy: '2', второй: '2',
  tri: '3', три: '3', tretiy: '3', третий: '3',
  chetyre: '4', четыре: '4', chetvertyy: '4', четвертый: '4',
  pyat: '5', пять: '5', pyatyy: '5', пятый: '5',
  shest: '6', шесть: '6', sem: '7', семь: '7', vosem: '8', восемь: '8', devyat: '9', девять: '9', desyat: '10', десять: '10',
  a: 'A', ay: 'A', optiona: 'A',
  b: 'B', bee: 'B', optionb: 'B',
  c: 'C', see: 'C', sea: 'C', optionc: 'C',
  d: 'D', dee: 'D', optiond: 'D',
  e: 'E', ee: 'E', optione: 'E',
  f: 'F', ef: 'F', optionf: 'F',
};

function cleanWords(raw: string) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-zа-яё0-9\s]/gi, ' ')
    .replace(/\b(option|number|choice|letter|pick|choose|select|выбери|вариант|номер|буква)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeChoiceKey(raw: string): string | null {
  const clean = cleanWords(raw);
  if (!clean) return null;
  const parts = clean.split(' ');
  for (const part of parts) {
    if (/^\d+$/.test(part)) return part;
    if (WORD_NUMBERS[part]) return WORD_NUMBERS[part];
    if (/^[a-f]$/.test(part)) return part.toUpperCase();
  }
  return null;
}

export function findChoice(menu: ChoiceMenu | null | undefined, spoken: string): ChoiceOption | null {
  if (!menu) return null;
  const key = normalizeChoiceKey(spoken);
  if (key) {
    const byKey = menu.options.find((option) => option.key.toUpperCase() === key.toUpperCase());
    if (byKey) return byKey;
  }

  const clean = cleanWords(spoken);
  if (!clean) return null;
  return menu.options.find((option) => {
    const label = cleanWords(option.label);
    if (label && (clean.includes(label) || label.includes(clean))) return true;
    return (option.aliases ?? []).some((alias) => {
      const a = cleanWords(alias);
      return a && (clean.includes(a) || a.includes(clean));
    });
  }) ?? null;
}
