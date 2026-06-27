export type AgaMode =
  | 'sleeping'
  | 'listening'
  | 'awake'
  | 'thinking'
  | 'speaking'
  | 'translating'
  | 'media'
  | 'settings'
  | 'recovering'
  | 'offline';

export type AgaIntent =
  | 'chat'
  | 'memory'
  | 'reminder'
  | 'notifications'
  | 'youtube'
  | 'media_control'
  | 'translation'
  | 'persona'
  | 'settings'
  | 'system'
  | 'unknown';

export type AgaAction =
  | { type: 'speak'; text: string }
  | { type: 'remember'; text: string }
  | { type: 'recall'; query?: string }
  | { type: 'set_persona'; persona: string }
  | { type: 'set_wake_phrase'; phrase: string }
  | { type: 'translate_start'; target: string }
  | { type: 'translate_stop' }
  | { type: 'open_settings' }
  | { type: 'show_diagnostics' }
  | { type: 'stop_speaking' }
  | { type: 'reset_conversation' }
  | { type: 'add_reminder'; text: string; dueAt: string }
  | { type: 'list_reminders' }
  | { type: 'clear_reminders' }
  | { type: 'request_notifications' }
  | { type: 'play_youtube'; query: string }
  | { type: 'youtube_play'; query: string }
  | { type: 'media_pause' }
  | { type: 'media_resume' }
  | { type: 'media_stop' }
  | { type: 'test_voice' }
  | { type: 'status' }
  | { type: 'chat'; text: string };

export type AgaTurn = {
  speech: string;
  intent: AgaIntent;
  actions: AgaAction[];
  handledLocally?: boolean;
};

const VALID_INTENTS = new Set<AgaIntent>([
  'chat',
  'memory',
  'reminder',
  'notifications',
  'youtube',
  'media_control',
  'translation',
  'persona',
  'settings',
  'system',
  'unknown',
]);

const ACTION_ALIASES: Record<string, AgaAction['type']> = {
  'youtube.play': 'play_youtube',
  'youtube.open': 'play_youtube',
  'media.youtube.play': 'play_youtube',
  'play.youtube': 'play_youtube',
  'youtube.control.pause': 'media_pause',
  'media.pause': 'media_pause',
  'music.pause': 'media_pause',
  'youtube.control.resume': 'media_resume',
  'media.resume': 'media_resume',
  'music.resume': 'media_resume',
  'youtube.control.stop': 'media_stop',
  'media.stop': 'media_stop',
  'music.stop': 'media_stop',
  'memory.save': 'remember',
  'memory.recall': 'recall',
  'reminder.create': 'add_reminder',
  'reminder.list': 'list_reminders',
  'reminder.clear': 'clear_reminders',
  'notifications.request': 'request_notifications',
  'persona.set': 'set_persona',
  'wake.set': 'set_wake_phrase',
  'translate.start': 'translate_start',
  'translate.stop': 'translate_stop',
  'conversation.reset': 'reset_conversation',
  'system.status': 'status',
  'system.health': 'status',
  'system.help': 'test_voice',
  'voice.stop': 'stop_speaking',
  'voice.test': 'test_voice',
  'settings.open': 'open_settings',
  'diagnostics.show': 'show_diagnostics',
};

function cleanText(value: unknown, max = 1200) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function actionType(value: unknown): AgaAction['type'] | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return (ACTION_ALIASES[normalized] ?? normalized) as AgaAction['type'];
}

function validIsoFutureish(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  // Accept near-past reminders because OS notification helpers nudge them forward.
  return time > Date.now() - 5 * 60_000;
}

export function sanitizeAction(input: unknown): AgaAction | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const type = actionType(raw.type ?? raw.action ?? raw.name);

  switch (type) {
    case 'speak': {
      const text = cleanText(raw.text ?? raw.speech ?? raw.body);
      return text ? { type, text } : null;
    }
    case 'remember': {
      const text = cleanText(raw.text ?? raw.memory ?? raw.content);
      return text ? { type, text } : null;
    }
    case 'recall': {
      const query = cleanText(raw.query ?? raw.text, 240);
      return query ? { type, query } : { type };
    }
    case 'set_persona': {
      const persona = cleanText(raw.persona ?? raw.value ?? raw.id, 80).toLowerCase();
      return persona ? { type, persona } : null;
    }
    case 'set_wake_phrase': {
      const phrase = cleanText(raw.phrase ?? raw.value ?? raw.text, 80).toLowerCase();
      return phrase ? { type, phrase } : null;
    }
    case 'translate_start': {
      const target = cleanText(raw.target ?? raw.language ?? raw.to, 80);
      return target ? { type, target } : null;
    }
    case 'add_reminder': {
      const text = cleanText(raw.text ?? raw.title ?? raw.body);
      const dueAt = cleanText(raw.dueAt ?? raw.due_at ?? raw.datetime ?? raw.when, 80);
      return text && validIsoFutureish(dueAt) ? { type, text, dueAt } : null;
    }
    case 'play_youtube':
    case 'youtube_play': {
      const query = cleanText(raw.query ?? raw.text ?? raw.title ?? raw.video, 240);
      return query ? { type: 'play_youtube', query } : null;
    }
    case 'chat': {
      const text = cleanText(raw.text ?? raw.query ?? raw.message);
      return text ? { type, text } : null;
    }
    case 'translate_stop':
    case 'open_settings':
    case 'show_diagnostics':
    case 'stop_speaking':
    case 'reset_conversation':
    case 'list_reminders':
    case 'clear_reminders':
    case 'request_notifications':
    case 'media_pause':
    case 'media_resume':
    case 'media_stop':
    case 'test_voice':
    case 'status':
      return { type } as AgaAction;
    default:
      return null;
  }
}

export function sanitizeTurn(input: unknown): AgaTurn | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Partial<AgaTurn>;
  const intent = typeof value.intent === 'string' && VALID_INTENTS.has(value.intent as AgaIntent)
    ? value.intent as AgaIntent
    : 'unknown';

  const actions = Array.isArray(value.actions)
    ? value.actions.map(sanitizeAction).filter(Boolean) as AgaAction[]
    : [];

  return {
    speech: cleanText(value.speech, 1400),
    intent,
    actions,
    handledLocally: Boolean(value.handledLocally),
  };
}