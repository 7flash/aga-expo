import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Database, z } from 'sqlite-zod-orm';

const databasePath = resolve(process.env.DATABASE_PATH ?? './data/assistant.db');
mkdirSync(dirname(databasePath), { recursive: true });

export const roleSchema = z.enum(['user', 'assistant']);

export const conversationSchema = z.object({
  title: z.string().min(1).default('New chat'),
});

export const messageSchema = z.object({
  conversationId: z.number().int().positive(),
  role: roleSchema,
  content: z.string().min(1),
});

export const preferenceSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
});

export const commandEventSchema = z.object({
  kind: z.string().min(1),
  payload: z.string().min(1).default('{}'),
});

export const mediaSessionSchema = z.object({
  provider: z.enum(['youtube', 'music', 'system']).default('system'),
  query: z.string().trim().max(240).default(''),
  title: z.string().trim().max(500).default(''),
  status: z.enum(['started', 'playing', 'paused', 'stopped', 'failed']).default('started'),
  payload: z.string().min(1).default('{}'),
});

export const translationSessionSchema = z.object({
  sourceLanguage: z.string().trim().min(2).max(40).default('auto'),
  targetLanguage: z.string().trim().min(2).max(40).default('English'),
  status: z.enum(['started', 'segment', 'stopped', 'failed']).default('started'),
  original: z.string().max(2_000).default(''),
  translated: z.string().max(2_000).default(''),
  provider: z.string().trim().max(40).default('unknown'),
});

export const agentRunSchema = z.object({
  goal: z.string().trim().min(1).max(2_000),
  agentName: z.string().trim().min(1).max(120).default('aga-main'),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'fallback']).default('queued'),
  result: z.string().max(8_000).default(''),
  payload: z.string().min(1).default('{}'),
});

export const assistantPreferencesSchema = z.object({
  assistantName: z.string().trim().min(1).max(32).default('AGA'),
  wakeWord: z.string().trim().min(1).max(24).default('aga'),
  voiceStyle: z.enum(['warm', 'bright', 'calm', 'coach', 'story']).default('warm'),
  voiceName: z.string().trim().max(120).optional().nullable(),
  autoListen: z.boolean().default(true),
  spokenReplies: z.boolean().default(true),
  translationTarget: z.string().trim().min(2).max(40).default('English'),
  translationSource: z.string().trim().min(2).max(40).default('auto'),
  youtubeAutoplay: z.boolean().default(true),
  musicAutoplay: z.boolean().default(true),
  confirmRiskyActions: z.boolean().default(true),
  agentMode: z.enum(['off', 'assistive', 'on_demand']).default('on_demand'),
  recoveryVoicePrompts: z.boolean().default(true),
});

export type Role = z.infer<typeof roleSchema>;
export type ChatMessage = z.infer<typeof messageSchema> & { id: number };
export type Conversation = z.infer<typeof conversationSchema> & { id: number };
export type AssistantPreferences = z.infer<typeof assistantPreferencesSchema>;
export type MediaSession = z.infer<typeof mediaSessionSchema> & { id: number };
export type TranslationSession = z.infer<typeof translationSessionSchema> & { id: number };
export type AgentRun = z.infer<typeof agentRunSchema> & { id: number };

const PREFERENCES_KEY = 'assistant.preferences.v4';
const STATE_KEY = 'assistant.runtime.state.v1';

export const defaultAssistantPreferences = assistantPreferencesSchema.parse({});

export const db = new Database(
  databasePath,
  {
    conversations: conversationSchema,
    messages: messageSchema,
    preferences: preferenceSchema,
    commandEvents: commandEventSchema,
    mediaSessions: mediaSessionSchema,
    translationSessions: translationSessionSchema,
    agentRuns: agentRunSchema,
  },
  {
    relations: {
      messages: { conversationId: 'conversations' },
    },
    timestamps: true,
  }
);

export function createConversation(title = 'New chat') {
  return db.conversations.insert({ title });
}

export function listConversations() {
  return db.conversations.select().orderBy('id', 'desc').limit(50).all();
}

export function getConversation(id: number) {
  return db.conversations.get(id);
}

export function saveMessage(input: z.infer<typeof messageSchema>) {
  return db.messages.insert(messageSchema.parse(input));
}

export function listMessages(conversationId: number) {
  return db.messages
    .select()
    .where({ conversationId })
    .orderBy('id', 'asc')
    .limit(100)
    .all();
}

export function saveCommandEvent(kind: string, payload: unknown) {
  return db.commandEvents.insert(
    commandEventSchema.parse({
      kind,
      payload: JSON.stringify(payload ?? {}),
    })
  );
}

export function listCommandEvents(limit = 50) {
  return db.commandEvents.select().orderBy('id', 'desc').limit(limit).all();
}

export function saveMediaSession(input: Partial<z.infer<typeof mediaSessionSchema>>) {
  return db.mediaSessions.insert(
    mediaSessionSchema.parse({
      ...input,
      payload: typeof input.payload === 'string' ? input.payload : JSON.stringify(input.payload ?? {}),
    })
  );
}

export function listMediaSessions(limit = 20) {
  return db.mediaSessions.select().orderBy('id', 'desc').limit(limit).all();
}

export function saveTranslationSession(input: Partial<z.infer<typeof translationSessionSchema>>) {
  return db.translationSessions.insert(translationSessionSchema.parse(input));
}

export function listTranslationSessions(limit = 20) {
  return db.translationSessions.select().orderBy('id', 'desc').limit(limit).all();
}

export function saveAgentRun(input: Partial<z.infer<typeof agentRunSchema>> & { goal: string }) {
  return db.agentRuns.insert(
    agentRunSchema.parse({
      ...input,
      payload: typeof input.payload === 'string' ? input.payload : JSON.stringify(input.payload ?? {}),
    })
  );
}

export function listAgentRuns(limit = 20) {
  return db.agentRuns.select().orderBy('id', 'desc').limit(limit).all();
}

export function getAssistantPreferences(): AssistantPreferences {
  const rows = db.preferences
    .select()
    .where({ key: PREFERENCES_KEY })
    .orderBy('id', 'desc')
    .limit(1)
    .all();

  const raw = rows[0]?.value;

  if (!raw) return defaultAssistantPreferences;

  try {
    return assistantPreferencesSchema.parse({
      ...defaultAssistantPreferences,
      ...JSON.parse(raw),
    });
  } catch {
    return defaultAssistantPreferences;
  }
}

export function saveAssistantPreferences(partial: Partial<AssistantPreferences>) {
  const next = assistantPreferencesSchema.parse({
    ...getAssistantPreferences(),
    ...partial,
  });

  db.preferences.insert({
    key: PREFERENCES_KEY,
    value: JSON.stringify(next),
  });

  saveCommandEvent('preferences.updated', { keys: Object.keys(partial) });
  return next;
}

export function getRuntimeState<T extends Record<string, unknown>>(fallback: T): T {
  const rows = db.preferences
    .select()
    .where({ key: STATE_KEY })
    .orderBy('id', 'desc')
    .limit(1)
    .all();

  const raw = rows[0]?.value;
  if (!raw) return fallback;

  try {
    return { ...fallback, ...JSON.parse(raw) } as T;
  } catch {
    return fallback;
  }
}

export function saveRuntimeState(state: Record<string, unknown>) {
  db.preferences.insert({
    key: STATE_KEY,
    value: JSON.stringify(state),
  });
  return state;
}
