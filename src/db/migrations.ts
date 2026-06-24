import { getDb } from './sqlite';

export async function migrate() {
  const db = await getDb();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT 'New chat',
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversationId INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(conversationId) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      activePersona TEXT NOT NULL DEFAULT 'warm',
      wakePhrase TEXT NOT NULL DEFAULT 'hey aga',
      speechRate REAL NOT NULL DEFAULT 1,
      pitch REAL NOT NULL DEFAULT 1.06,
      translateTargetLang TEXT,
      backendMode TEXT NOT NULL DEFAULT 'openai-direct',
      openaiApiKey TEXT,
      geminiApiKey TEXT,
      openaiModel TEXT NOT NULL DEFAULT 'gpt-5.5',
      geminiModel TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    INSERT OR IGNORE INTO user_preferences (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      payload TEXT,
      durationMs REAL,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS media_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK(kind IN ('youtube', 'music')),
      title TEXT NOT NULL,
      artist TEXT,
      query TEXT NOT NULL,
      ref TEXT,
      artworkUrl TEXT,
      state TEXT NOT NULL CHECK(state IN ('playing', 'paused', 'stopped')) DEFAULT 'playing',
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversationId, id);
    CREATE INDEX IF NOT EXISTS idx_event_log_created ON event_log(createdAt);
    CREATE INDEX IF NOT EXISTS idx_media_sessions_updated ON media_sessions(updatedAt);
  `);
}
