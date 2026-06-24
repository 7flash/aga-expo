import { all, first, run } from './sqlite';
import type { ChatMessage, Conversation, Role } from './schema';

export async function getOrCreateConversation(title = 'AGA chat'): Promise<Conversation> {
  const existing = await first<Conversation>('SELECT * FROM conversations ORDER BY id DESC LIMIT 1');
  if (existing) return existing;
  const result = await run('INSERT INTO conversations (title) VALUES (?)', [title]);
  return first<Conversation>('SELECT * FROM conversations WHERE id = ?', [result.lastInsertRowId]) as Promise<Conversation>;
}

export async function createConversation(title = 'New chat'): Promise<Conversation> {
  const result = await run('INSERT INTO conversations (title) VALUES (?)', [title]);
  return first<Conversation>('SELECT * FROM conversations WHERE id = ?', [result.lastInsertRowId]) as Promise<Conversation>;
}

export async function listMessages(conversationId: number, limit = 80): Promise<ChatMessage[]> {
  return all<ChatMessage>('SELECT * FROM messages WHERE conversationId = ? ORDER BY id ASC LIMIT ?', [conversationId, limit]);
}

export async function saveMessage(conversationId: number, role: Role, content: string): Promise<ChatMessage> {
  const result = await run('INSERT INTO messages (conversationId, role, content) VALUES (?, ?, ?)', [conversationId, role, content]);
  await run('UPDATE conversations SET updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [conversationId]);
  return first<ChatMessage>('SELECT * FROM messages WHERE id = ?', [result.lastInsertRowId]) as Promise<ChatMessage>;
}

export async function renameConversation(conversationId: number, title: string) {
  await run('UPDATE conversations SET title = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [title.slice(0, 80), conversationId]);
}
