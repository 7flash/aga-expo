import { all, first, run } from './sqlite';
import { migrate } from './migrations';

export type BackupSnapshot = {
  app: 'AGA';
  version: 2;
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
  'event_log',
] as const;

async function count(table: string) {
  const row = await first<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`);
  return Number(row?.count ?? 0);
}

export async function createBackupSnapshot(): Promise<BackupSnapshot> {
  await migrate();
  const entries = await Promise.all(TABLES.map(async (table) => [table, await all(`SELECT * FROM ${table} ORDER BY id ASC`)] as const));
  return {
    app: 'AGA',
    version: 2,
    exportedAt: new Date().toISOString(),
    tables: Object.fromEntries(entries),
  };
}

export async function createBackupJson() {
  return JSON.stringify(await createBackupSnapshot(), null, 2);
}

export async function getStorageSummary(): Promise<StorageSummary> {
  const [conversations, messages, memories, reminders, mediaSessions, mediaQueue, events] = await Promise.all([
    count('conversations'),
    count('messages'),
    count('memory_facts'),
    count('reminders'),
    count('media_sessions'),
    count('media_queue'),
    count('event_log'),
  ]);
  const json = await createBackupJson();
  return {
    conversations,
    messages,
    memories,
    reminders,
    mediaSessions,
    mediaQueue,
    events,
    backupBytes: json.length,
  };
}

export async function clearEventLog() {
  await run('DELETE FROM event_log');
}

export async function selfRepairDatabase() {
  await migrate();
  await run("UPDATE media_queue SET status = 'cleared', updatedAt = CURRENT_TIMESTAMP WHERE status IN ('played', 'failed', 'skipped') AND id NOT IN (SELECT id FROM media_queue ORDER BY id DESC LIMIT 50)");
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
  await run('DELETE FROM event_log');
  await run('DELETE FROM user_preferences WHERE id = 1');
  await run('INSERT OR IGNORE INTO user_preferences (id) VALUES (1)');
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
    for (const row of rows as Record<string, unknown>[]) {
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
  return `${summary.conversations} conversations, ${summary.messages} messages, ${summary.memories} memories, ${summary.reminders} reminders, ${summary.mediaQueue} queued media items, and ${summary.events} log events. Backup size is about ${kb} kilobytes.`;
}
