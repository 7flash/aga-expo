export type ChoiceAction =
  | { type: 'show_menu'; menu: 'main' | 'voice' | 'personality' | 'session' | 'language' | 'imagination' }
  | { type: 'set_voice'; voice: string; label: string }
  | { type: 'set_persona'; persona: string; label: string }
  | { type: 'regenerate_personality'; style: string; label: string }
  | { type: 'start_session'; kind: 'language' | 'imagination' | 'advice' | 'general'; label: string; targetLanguage?: string; theme?: string }
  | { type: 'end_session' };

export type ChoiceOption = {
  key: string;
  label: string;
  description?: string;
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

export function buildChoiceMenu(kind: string | null | undefined): ChoiceMenu {
  const normalized = String(kind ?? 'main').toLowerCase().trim();
  if (normalized === 'voice') {
    return menu('voice', 'Choose AGA voice', 'Say the number or letter. Example: “two”.', [
      { key: '1', label: 'Marin', description: 'soft, warm, close', action: { type: 'set_voice', voice: 'marin', label: 'Marin' } },
      { key: '2', label: 'Cedar', description: 'grounded and clear', action: { type: 'set_voice', voice: 'cedar', label: 'Cedar' } },
      { key: '3', label: 'Alloy', description: 'balanced and neutral', action: { type: 'set_voice', voice: 'alloy', label: 'Alloy' } },
      { key: '4', label: 'Shimmer', description: 'bright and airy', action: { type: 'set_voice', voice: 'shimmer', label: 'Shimmer' } },
      { key: '5', label: 'Verse', description: 'expressive storyteller', action: { type: 'set_voice', voice: 'verse', label: 'Verse' } },
    ]);
  }
  if (normalized === 'personality') {
    return menu('personality', 'Choose personality', 'Say a number, or say “regenerate personality”.', [
      { key: '1', label: 'Warm guardian', description: 'kind, protective, concise', action: { type: 'set_persona', persona: 'warm', label: 'Warm guardian' } },
      { key: '2', label: 'Calm guide', description: 'slow, peaceful, grounding', action: { type: 'set_persona', persona: 'calm', label: 'Calm guide' } },
      { key: '3', label: 'Bright friend', description: 'playful and encouraging', action: { type: 'set_persona', persona: 'bright', label: 'Bright friend' } },
      { key: '4', label: 'Focus coach', description: 'direct, clear, action-oriented', action: { type: 'set_persona', persona: 'coach', label: 'Focus coach' } },
      { key: '5', label: 'Regenerate for me', description: 'AGA creates a fresh personality blend', action: { type: 'regenerate_personality', style: 'fresh guardian blend', label: 'Regenerated personality' } },
    ]);
  }
  if (normalized === 'language') {
    return menu('language', 'Language learning session', 'Choose a practice mode by saying the number.', [
      { key: '1', label: 'English conversation', description: 'gentle speaking practice', action: { type: 'start_session', kind: 'language', label: 'English conversation practice', targetLanguage: 'English', theme: 'conversation' } },
      { key: '2', label: 'Indonesian conversation', description: 'Bahasa practice with corrections', action: { type: 'start_session', kind: 'language', label: 'Indonesian conversation practice', targetLanguage: 'Indonesian', theme: 'conversation' } },
      { key: '3', label: 'Russian basics', description: 'simple phrases and pronunciation', action: { type: 'start_session', kind: 'language', label: 'Russian basics', targetLanguage: 'Russian', theme: 'basics' } },
      { key: '4', label: 'Roleplay travel', description: 'airport, cafe, directions', action: { type: 'start_session', kind: 'language', label: 'Travel roleplay', targetLanguage: 'English', theme: 'travel' } },
    ]);
  }
  if (normalized === 'imagination') {
    return menu('imagination', 'Imagination game', 'Choose a world. AGA will narrate and you answer by voice.', [
      { key: '1', label: 'Crystal forest', description: 'calm magical exploration', action: { type: 'start_session', kind: 'imagination', label: 'Crystal forest imagination game', theme: 'crystal forest' } },
      { key: '2', label: 'Space guardian', description: 'gentle sci-fi mission', action: { type: 'start_session', kind: 'imagination', label: 'Space guardian imagination game', theme: 'space guardian' } },
      { key: '3', label: 'Tiny kingdom', description: 'cozy fantasy story', action: { type: 'start_session', kind: 'imagination', label: 'Tiny kingdom imagination game', theme: 'tiny kingdom' } },
    ]);
  }
  if (normalized === 'session') {
    return menu('session', 'Start a new session', 'Say the number to switch AGA’s mode.', [
      { key: '1', label: 'Language learning', description: 'practice with corrections', action: { type: 'show_menu', menu: 'language' } },
      { key: '2', label: 'Imagination game', description: 'voice-only story play', action: { type: 'show_menu', menu: 'imagination' } },
      { key: '3', label: 'Calm advice', description: 'short supportive guidance', action: { type: 'start_session', kind: 'advice', label: 'Calm advice session', theme: 'calm advice' } },
      { key: '4', label: 'General guardian', description: 'normal AGA mode', action: { type: 'start_session', kind: 'general', label: 'General guardian session' } },
    ]);
  }
  return menu('main', 'AGA settings', 'No buttons needed. Say a number or letter.', [
    { key: 'A', label: 'Change voice', description: 'choose a Realtime voice', action: { type: 'show_menu', menu: 'voice' } },
    { key: 'B', label: 'Change personality', description: 'warm, calm, bright, coach, or regenerate', action: { type: 'show_menu', menu: 'personality' } },
    { key: 'C', label: 'Start language learning', description: 'practice a language by voice', action: { type: 'show_menu', menu: 'language' } },
    { key: 'D', label: 'Play imagination game', description: 'a guided voice story', action: { type: 'show_menu', menu: 'imagination' } },
    { key: 'E', label: 'Start new session', description: 'clear the current mode and choose one', action: { type: 'show_menu', menu: 'session' } },
  ]);
}

const WORD_NUMBERS: Record<string, string> = {
  one: '1', first: '1', won: '1',
  two: '2', second: '2', to: '2', too: '2',
  three: '3', third: '3', tree: '3',
  four: '4', fourth: '4', for: '4',
  five: '5', fifth: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  a: 'A', ay: 'A', optiona: 'A',
  b: 'B', bee: 'B', optionb: 'B',
  c: 'C', see: 'C', sea: 'C', optionc: 'C',
  d: 'D', dee: 'D', optiond: 'D',
  e: 'E', ee: 'E', optione: 'E',
};

export function normalizeChoiceKey(raw: string): string | null {
  const clean = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(option|number|choice|letter|pick|choose|select)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return null;
  const parts = clean.split(' ');
  for (const part of parts) {
    if (/^\d+$/.test(part)) return part;
    if (WORD_NUMBERS[part]) return WORD_NUMBERS[part];
    if (/^[a-e]$/.test(part)) return part.toUpperCase();
  }
  return null;
}

export function findChoice(menu: ChoiceMenu | null | undefined, spoken: string): ChoiceOption | null {
  if (!menu) return null;
  const key = normalizeChoiceKey(spoken);
  if (!key) return null;
  return menu.options.find((option) => option.key.toUpperCase() === key.toUpperCase()) ?? null;
}
