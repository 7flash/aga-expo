import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Database, z } from 'sqlite-zod-orm';

const databasePath = resolve(process.env.DATABASE_PATH ?? './data/geeksy.db');
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

export type Role = z.infer<typeof roleSchema>;
export type ChatMessage = z.infer<typeof messageSchema> & { id: number };
export type Conversation = z.infer<typeof conversationSchema> & { id: number };

export const db = new Database(
  databasePath,
  {
    conversations: conversationSchema,
    messages: messageSchema,
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
