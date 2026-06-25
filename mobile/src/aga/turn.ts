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

export function sanitizeTurn(input: unknown): AgaTurn | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Partial<AgaTurn>;
  const intent = typeof value.intent === 'string' && VALID_INTENTS.has(value.intent as AgaIntent)
    ? value.intent as AgaIntent
    : 'unknown';

  return {
    speech: typeof value.speech === 'string' ? value.speech.trim() : '',
    intent,
    actions: Array.isArray(value.actions) ? value.actions.filter(Boolean) as AgaAction[] : [],
    handledLocally: Boolean(value.handledLocally),
  };
}
