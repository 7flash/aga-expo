import { all, first, run } from './sqlite';
import { migrate } from './migrations';

export type BackupSnapshot = {
  app: 'AGA';
  version: 4;
  exportedAt: string;
  tables: Record<string, unknown[]>;
};

export type StorageSummary = {
  conversations: number;
  messages: number;
  memories: number;
  reminders: number;
  mediaSessions: number;
  mediaQueue: number;
  favorites: number;
  translations: number;
  routines: number;
  events: number;
  backupBytes: number;
};

const TABLES = [
  'conversations',
  'messages',
  'user_preferences',
  'memory_facts',
  'reminders',
  'proactive_events',
  'media_sessions',
  'media_queue',
  'media_favorites',
  'translation_history',
  'routines',
  'event_log',
] as const;

type BackupTable = typeof TABLES[number];

const ALLOWED_COLUMNS: Record<BackupTable, readonly string[]> = {
  conversations: ['id', 'title', 'createdAt', 'updatedAt'],
  messages: ['id', 'conversationId', 'role', 'content', 'createdAt'],
  user_preferences: [
    'id',
    'activePersona',
    'wakePhrase',
    'speechRate',
    'pitch',
    'translateTargetLang',
    'backendMode',
    'openaiModel',
    'geminiModel',
    'remoteBackendUrl',
    'voiceLocale',
    'firstRunComplete',
    'speechWatchdogEnabled',
    'proactiveEnabled',
    'localNotificationsEnabled',
    'quietHoursStart',
    'quietHoursEnd',
    'updatedAt',
  ],
  memory_facts: ['id', 'text', 'source', 'pinned', 'createdAt', 'updatedAt'],
  reminders: ['id', 'title', 'dueAt', 'status', 'source', 'notificationId', 'createdAt', 'updatedAt'],
  proactive_events: ['id', 'kind', 'speech', 'payload', 'status', 'createdAt', 'updatedAt'],
  media_sessions: ['id', 'kind', 'title', 'artist', 'query', 'ref', 'artworkUrl', 'state', 'createdAt', 'updatedAt'],
  media_queue: ['id', 'kind', 'query', 'title', 'artist', 'ref', 'artworkUrl', 'status', 'sortOrder', 'createdAt', 'updatedAt'],
  media_favorites: ['id', 'kind', 'title', 'artist', 'query', 'ref', 'artworkUrl', 'createdAt', 'updatedAt'],
  translation_history: ['id', 'sourceText', 'translatedText', 'fromLang', 'toLang', 'createdAt'],
  routines: ['id', 'title', 'prompt', 'timeOfDay', 'daysOfWeek', 'enabled', 'lastFiredAt', 'createdAt', 'updatedAt'],
  event_log: ['id', 'kind', 'label', 'payload', 'durationMs', 'createdAt'],
};

async function count(table: string) {
  const row = await first<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`);
  return Number(row?.count ?? 0);
}

function filterRowForBackup(table: BackupTable, row: Record<string, unknown>) {
  const allowed = new Set(ALLOWED_COLUMNS[table]);
  return Object.fromEntries(Object.entries(row).filter(([key]) => allowed.has(key)));
}

async function estimateDatabaseBytes() {
  try {
    const pageCount = await first<Record<string, number>>('PRAGMA page_count');
    const pageSize = await first<Record<string, number>>('PRAGMA page_size');
    const pages = Number(pageCount?.page_count ?? Object.values(pageCount ?? {})[0] ?? 0);
    const size = Number(pageSize?.page_size ?? Object.values(pageSize ?? {})[0] ?? 0);
    return pages > 0 && size > 0 ? pages * size : 0;
  } catch {
    return 0;
  }
}

export async function createBackupSnapshot(): Promise<BackupSnapshot> {
  await migrate();
  const entries = await Promise.all(TABLES.map(async (table) => {
    const columns = ALLOWED_COLUMNS[table].join(', ');
    const rows = await all<Record<string, unknown>>(`SELECT ${columns} FROM ${table} ORDER BY id ASC`);
    return [table, rows.map((row) => filterRowForBackup(table, row))] as const;
  }));
  return {
    app: 'AGA',
    version: 4,
    exportedAt: new Date().toISOString(),
    tables: Object.fromEntries(entries),
  };
}

export async function createBackupJson() {
  return JSON.stringify(await createBackupSnapshot(), null, 2);
}

export async function getStorageSummary(): Promise<StorageSummary> {
  const [conversations, messages, memories, reminders, mediaSessions, mediaQueue, favorites, translations, routines, events, databaseBytes] = await Promise.all([
    count('conversations'),
    count('messages'),
    count('memory_facts'),
    count('reminders'),
    count('media_sessions'),
    count('media_queue'),
    count('media_favorites'),
    count('translation_history'),
    count('routines'),
    count('event_log'),
    estimateDatabaseBytes(),
  ]);
  return {
    conversations,
    messages,
    memories,
    reminders,
    mediaSessions,
    mediaQueue,
    favorites,
    translations,
    routines,
    events,
    backupBytes: databaseBytes,
  };
}

export async function clearEventLog() {
  await run('DELETE FROM event_log');
}

export async function selfRepairDatabase() {
  await migrate();
  await run("UPDATE media_queue SET status = 'cleared', updatedAt = CURRENT_TIMESTAMP WHERE status IN ('played', 'failed', 'skipped') AND id NOT IN (SELECT id FROM media_queue ORDER BY id DESC LIMIT 50)");
  await run("DELETE FROM translation_history WHERE id NOT IN (SELECT id FROM translation_history ORDER BY id DESC LIMIT 200)");
  await run('DELETE FROM event_log WHERE id NOT IN (SELECT id FROM event_log ORDER BY id DESC LIMIT 500)');
  await run('PRAGMA optimize');
  return getStorageSummary();
}

export async function factoryResetLocalData() {
  await migrate();
  await run('DELETE FROM messages');
  await run('DELETE FROM conversations');
  await run('DELETE FROM memory_facts');
  await run('DELETE FROM reminders');
  await run('DELETE FROM proactive_events');
  await run('DELETE FROM media_sessions');
  await run('DELETE FROM media_queue');
  await run('DELETE FROM media_favorites');
  await run('DELETE FROM translation_history');
  await run('DELETE FROM routines');
  await run('DELETE FROM event_log');
  await run('DELETE FROM user_preferences WHERE id = 1');
  await run('INSERT OR IGNORE INTO user_preferences (id) VALUES (1)');
}

function safeImportRow(table: BackupTable, row: Record<string, unknown>) {
  const allowed = new Set(ALLOWED_COLUMNS[table]);
  const entries = Object.entries(row).filter(([key]) => allowed.has(key));
  return Object.fromEntries(entries);
}

export async function importBackupJson(json: string) {
  const parsed = JSON.parse(json) as BackupSnapshot;
  if (!parsed || parsed.app !== 'AGA' || !parsed.tables || typeof parsed.tables !== 'object') {
    throw new Error('This does not look like an AGA backup.');
  }
  await migrate();
  for (const table of TABLES) {
    const rows = parsed.tables[table];
    if (!Array.isArray(rows) || !rows.length) continue;
    for (const rawRow of rows as Record<string, unknown>[]) {
      const row = safeImportRow(table, rawRow);
      const keys = Object.keys(row);
      if (!keys.length) continue;
      const placeholders = keys.map(() => '?').join(', ');
      await run(`INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`, keys.map((key) => row[key]));
    }
  }
  return getStorageSummary();
}

export function summarizeStorage(summary: StorageSummary) {
  const kb = Math.max(1, Math.round(summary.backupBytes / 1024));
  return `${summary.conversations} conversations, ${summary.messages} messages, ${summary.memories} memories, ${summary.reminders} reminders, ${summary.mediaQueue} queued media items, ${summary.favorites} favorites, ${summary.translations} translations, ${summary.routines} routines, and ${summary.events} log events. SQLite database is about ${kb} kilobytes.`;
}
