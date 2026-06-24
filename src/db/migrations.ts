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
      remoteBackendUrl TEXT,
      remoteBackendToken TEXT,
      voiceLocale TEXT NOT NULL DEFAULT 'en-US',
      firstRunComplete INTEGER NOT NULL DEFAULT 0,
      speechWatchdogEnabled INTEGER NOT NULL DEFAULT 1,
      proactiveEnabled INTEGER NOT NULL DEFAULT 1,
      localNotificationsEnabled INTEGER NOT NULL DEFAULT 1,
      quietHoursStart TEXT,
      quietHoursEnd TEXT,
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

    CREATE TABLE IF NOT EXISTS media_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK(kind IN ('youtube', 'music')),
      query TEXT NOT NULL,
      title TEXT,
      artist TEXT,
      ref TEXT,
      artworkUrl TEXT,
      status TEXT NOT NULL CHECK(status IN ('queued', 'playing', 'played', 'skipped', 'failed', 'cleared')) DEFAULT 'queued',
      sortOrder INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS memory_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('voice', 'assistant', 'settings')) DEFAULT 'voice',
      pinned INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      dueAt TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'fired', 'cancelled')) DEFAULT 'pending',
      source TEXT NOT NULL CHECK(source IN ('voice', 'settings')) DEFAULT 'voice',
      notificationId TEXT,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS proactive_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK(kind IN ('reminder', 'routine', 'agent', 'system')),
      speech TEXT NOT NULL,
      payload TEXT,
      status TEXT NOT NULL CHECK(status IN ('queued', 'spoken', 'dismissed')) DEFAULT 'queued',
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );



    CREATE TABLE IF NOT EXISTS media_favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK(kind IN ('youtube', 'music')),
      title TEXT NOT NULL,
      artist TEXT,
      query TEXT NOT NULL,
      ref TEXT,
      artworkUrl TEXT,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS translation_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sourceText TEXT NOT NULL,
      translatedText TEXT NOT NULL,
      fromLang TEXT,
      toLang TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS routines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      timeOfDay TEXT NOT NULL,
      daysOfWeek TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      lastFiredAt TEXT,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversationId, id);
    CREATE INDEX IF NOT EXISTS idx_event_log_created ON event_log(createdAt);
    CREATE INDEX IF NOT EXISTS idx_media_sessions_updated ON media_sessions(updatedAt);
    CREATE INDEX IF NOT EXISTS idx_media_queue_status ON media_queue(status, sortOrder, id);
    CREATE INDEX IF NOT EXISTS idx_memory_facts_updated ON memory_facts(updatedAt);
    CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, dueAt);
    CREATE INDEX IF NOT EXISTS idx_proactive_status ON proactive_events(status, id);
    CREATE INDEX IF NOT EXISTS idx_media_favorites_updated ON media_favorites(updatedAt);
    CREATE INDEX IF NOT EXISTS idx_translation_history_created ON translation_history(createdAt);
    CREATE INDEX IF NOT EXISTS idx_routines_enabled ON routines(enabled, timeOfDay);
  `);

  await ensureColumn('user_preferences', 'remoteBackendUrl', 'TEXT');
  await ensureColumn('user_preferences', 'remoteBackendToken', 'TEXT');
  await ensureColumn('user_preferences', 'voiceLocale', "TEXT NOT NULL DEFAULT 'en-US'");
  await ensureColumn('user_preferences', 'firstRunComplete', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('user_preferences', 'speechWatchdogEnabled', 'INTEGER NOT NULL DEFAULT 1');
  await ensureColumn('user_preferences', 'proactiveEnabled', 'INTEGER NOT NULL DEFAULT 1');
  await ensureColumn('user_preferences', 'localNotificationsEnabled', 'INTEGER NOT NULL DEFAULT 1');
  await ensureColumn('user_preferences', 'quietHoursStart', 'TEXT');
  await ensureColumn('user_preferences', 'quietHoursEnd', 'TEXT');
  await ensureColumn('reminders', 'notificationId', 'TEXT');
}

async function ensureColumn(table: string, column: string, definition: string) {
  const db = await getDb();
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!columns.some((item) => item.name === column)) {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
