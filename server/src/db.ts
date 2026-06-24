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
});

export type Role = z.infer<typeof roleSchema>;
export type ChatMessage = z.infer<typeof messageSchema> & { id: number };
export type Conversation = z.infer<typeof conversationSchema> & { id: number };
export type AssistantPreferences = z.infer<typeof assistantPreferencesSchema>;

const PREFERENCES_KEY = 'assistant.preferences.v3';

export const defaultAssistantPreferences = assistantPreferencesSchema.parse({});

export const db = new Database(
  databasePath,
  {
    conversations: conversationSchema,
    messages: messageSchema,
    preferences: preferenceSchema,
    commandEvents: commandEventSchema,
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

  return next;
}
