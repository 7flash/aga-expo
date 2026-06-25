import { getPersona } from '../aga/personas';

type SQLiteDatabase = any;

type Preferences = {
  wakePhrase: string;
  persona: string;
  voiceLocale: string;
  openaiApiKey: string;
  geminiApiKey: string;
  brainMode: 'offline' | 'openai' | 'gemini';
  translateTarget: string | null;
  showDiagnostics: boolean;
  proactiveReminders: boolean;
};

export type { Preferences };

const DEFAULT_PREFS: Preferences = {
  wakePhrase: 'hey aga',
  persona: 'warm',
  voiceLocale: 'en-US',
  openaiApiKey: process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? '',
  geminiApiKey: process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '',
  brainMode: ((process.env.EXPO_PUBLIC_AGA_BRAIN_MODE as Preferences['brainMode']) || 'openai') as Preferences['brainMode'],
  translateTarget: null,
  showDiagnostics: false,
  proactiveReminders: true,
};

let dbPromise: Promise<SQLiteDatabase | null> | null = null;
let dbOpenRetries = 0;
let lastDbOpenError: string | null = null;
let memoryFallback = {
  prefs: { ...DEFAULT_PREFS },
  messages: [] as Array<{ role: string; content: string; createdAt: string }>,
  memories: [] as Array<{ text: string; createdAt: string }>,
  reminders: [] as Array<{ id: number; text: string; dueAt: string; delivered: number; createdAt: string }>,
  events: [] as Array<{ label: string; detail: string; createdAt: string }>,
};

function rememberLocalEvent(label: string, detail = '') {
  memoryFallback.events.push({ label, detail, createdAt: new Date().toISOString() });
  memoryFallback.events = memoryFallback.events.slice(-80);
}

async function importSQLite() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-sqlite');
  } catch {
    return null;
  }
}

async function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const SQLite = await importSQLite();
    if (!SQLite) return null;
    const anySQLite = SQLite as any;
    if (typeof anySQLite.openDatabaseAsync === 'function') {
      return anySQLite.openDatabaseAsync('aga-local.db');
    }
    if (typeof anySQLite.openDatabaseSync === 'function') {
      return anySQLite.openDatabaseSync('aga-local.db');
    }
    if (typeof anySQLite.openDatabase === 'function') {
      return anySQLite.openDatabase('aga-local.db');
    }
    return null;
  })().catch((error) => {
    dbPromise = null;
    dbOpenRetries += 1;
    lastDbOpenError = error instanceof Error ? error.message : String(error || 'SQLite open failed');
    rememberLocalEvent('db.open.error', lastDbOpenError);
    return null;
  });
  return dbPromise;
}

async function exec(db: SQLiteDatabase | null, sql: string, params: any[] = []) {
  if (!db) return;
  if (typeof db.execAsync === 'function' && params.length === 0) return db.execAsync(sql);
  if (typeof db.runAsync === 'function') return db.runAsync(sql, params);
  if (typeof db.transaction === 'function') {
    return new Promise<void>((resolve, reject) => {
      db.transaction((tx: any) => {
        tx.executeSql(sql, params, () => resolve(), (_: any, error: any) => { reject(error); return false; });
      });
    });
  }
}

async function all<T = any>(db: SQLiteDatabase | null, sql: string, params: any[] = []): Promise<T[]> {
  if (!db) return [];
  if (typeof db.getAllAsync === 'function') return db.getAllAsync(sql, params);
  if (typeof db.transaction === 'function') {
    return new Promise<T[]>((resolve, reject) => {
      db.transaction((tx: any) => {
        tx.executeSql(sql, params, (_: any, result: any) => resolve(result.rows._array ?? []), (_: any, error: any) => { reject(error); return false; });
      });
    });
  }
  return [];
}

async function first<T = any>(db: SQLiteDatabase | null, sql: string, params: any[] = []): Promise<T | null> {
  const rows = await all<T>(db, sql, params);
  return rows[0] ?? null;
}

export async function initializeLocalStore() {
  try {
    const db = await openDb();
    if (!db) return { sqliteAvailable: false };
    await exec(db, `PRAGMA journal_mode = WAL;`);
    await exec(db, `CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);`);
    await exec(db, `CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, content TEXT NOT NULL, createdAt TEXT NOT NULL);`);
    await exec(db, `CREATE TABLE IF NOT EXISTS memories (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, createdAt TEXT NOT NULL);`);
    await exec(db, `CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, dueAt TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL);`);
    await exec(db, `CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, detail TEXT NOT NULL, createdAt TEXT NOT NULL);`);
    const prefs = await loadPreferences();
    await savePreferences({ ...DEFAULT_PREFS, ...prefs });
    return { sqliteAvailable: true };
  } catch (error) {
    dbPromise = null;
    dbOpenRetries += 1;
    lastDbOpenError = error instanceof Error ? error.message : String(error || 'SQLite init failed');
    rememberLocalEvent('db.init.error', lastDbOpenError);
    return { sqliteAvailable: false };
  }
}

export async function loadPreferences(): Promise<Preferences> {
  const db = await openDb();
  if (!db) return { ...memoryFallback.prefs };
  try {
    const rows = await all<{ key: string; value: string }>(db, 'SELECT key, value FROM preferences');
    const prefs: any = { ...DEFAULT_PREFS };
    for (const row of rows) {
      try { prefs[row.key] = JSON.parse(row.value); } catch { prefs[row.key] = row.value; }
    }
    return prefs;
  } catch (error) {
    lastDbOpenError = error instanceof Error ? error.message : String(error || 'load prefs failed');
    rememberLocalEvent('db.prefs.error', lastDbOpenError);
    return { ...memoryFallback.prefs };
  }
}

export async function savePreferences(input: Partial<Preferences>) {
  const next = { ...(await loadPreferences()), ...input } as Preferences;
  memoryFallback.prefs = next;
  const db = await openDb();
  if (!db) return next;
  try {
    for (const [key, value] of Object.entries(next)) {
      await exec(db, 'INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
    }
  } catch (error) {
    lastDbOpenError = error instanceof Error ? error.message : String(error || 'save prefs failed');
    rememberLocalEvent('db.prefs.save.error', lastDbOpenError);
  }
  return next;
}

export async function addMessage(role: 'user' | 'assistant', content: string) {
  const createdAt = new Date().toISOString();
  memoryFallback.messages.push({ role, content, createdAt });
  const db = await openDb();
  if (db) await exec(db, 'INSERT INTO messages (role, content, createdAt) VALUES (?, ?, ?)', [role, content, createdAt]);
}

export async function listMessages(limit = 20) {
  const db = await openDb();
  if (!db) return memoryFallback.messages.slice(-limit);
  return all<{ role: 'user' | 'assistant'; content: string; createdAt: string }>(
    db,
    'SELECT role, content, createdAt FROM messages ORDER BY id DESC LIMIT ?',
    [limit]
  ).then((rows) => rows.reverse()).catch(() => memoryFallback.messages.slice(-limit));
}

export async function clearMessages() {
  memoryFallback.messages = [];
  const db = await openDb();
  if (db) await exec(db, 'DELETE FROM messages');
}

export async function addMemory(text: string) {
  const createdAt = new Date().toISOString();
  memoryFallback.memories.push({ text, createdAt });
  const db = await openDb();
  if (db) await exec(db, 'INSERT INTO memories (text, createdAt) VALUES (?, ?)', [text, createdAt]);
}

export async function searchMemories(query?: string, limit = 8) {
  const db = await openDb();
  const q = query?.trim().toLowerCase();
  if (!db) {
    return memoryFallback.memories
      .filter((m) => !q || m.text.toLowerCase().includes(q))
      .slice(-limit)
      .reverse();
  }
  if (q) {
    return all<{ text: string; createdAt: string }>(
      db,
      'SELECT text, createdAt FROM memories WHERE lower(text) LIKE ? ORDER BY id DESC LIMIT ?',
      [`%${q}%`, limit]
    ).catch(() => memoryFallback.memories.filter((m) => m.text.toLowerCase().includes(q)).slice(-limit).reverse());
  }
  return all<{ text: string; createdAt: string }>(db, 'SELECT text, createdAt FROM memories ORDER BY id DESC LIMIT ?', [limit])
    .catch(() => memoryFallback.memories.slice(-limit).reverse());
}

export type Reminder = {
  id: number;
  text: string;
  dueAt: string;
  delivered: number;
  createdAt: string;
};

export async function addReminder(text: string, dueAt: string) {
  const createdAt = new Date().toISOString();
  const db = await openDb();
  if (!db) {
    const id = Date.now();
    memoryFallback.reminders.push({ id, text, dueAt, delivered: 0, createdAt });
    return { id, text, dueAt, delivered: 0, createdAt };
  }
  await exec(db, 'INSERT INTO reminders (text, dueAt, delivered, createdAt) VALUES (?, ?, 0, ?)', [text, dueAt, createdAt]);
  const row = await first<Reminder>(db, 'SELECT id, text, dueAt, delivered, createdAt FROM reminders ORDER BY id DESC LIMIT 1');
  return row ?? { id: Date.now(), text, dueAt, delivered: 0, createdAt };
}

export async function listPendingReminders(limit = 8) {
  const db = await openDb();
  if (!db) {
    return memoryFallback.reminders
      .filter((reminder) => !reminder.delivered)
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
      .slice(0, limit);
  }
  return all<Reminder>(
    db,
    'SELECT id, text, dueAt, delivered, createdAt FROM reminders WHERE delivered = 0 ORDER BY dueAt ASC LIMIT ?',
    [limit]
  ).catch(() => memoryFallback.reminders.filter((reminder) => !reminder.delivered).slice(0, limit));
}

export async function drainDueReminders(now = new Date()) {
  const nowIso = now.toISOString();
  const db = await openDb();
  if (!db) {
    const due = memoryFallback.reminders.filter((reminder) => !reminder.delivered && reminder.dueAt <= nowIso);
    memoryFallback.reminders = memoryFallback.reminders.map((reminder) => due.some((item) => item.id === reminder.id) ? { ...reminder, delivered: 1 } : reminder);
    return due;
  }
  const due = await all<Reminder>(
    db,
    'SELECT id, text, dueAt, delivered, createdAt FROM reminders WHERE delivered = 0 AND dueAt <= ? ORDER BY dueAt ASC LIMIT 5',
    [nowIso]
  ).catch(() => []);
  for (const reminder of due) {
    await exec(db, 'UPDATE reminders SET delivered = 1 WHERE id = ?', [reminder.id]);
  }
  return due;
}

export async function clearReminders() {
  memoryFallback.reminders = [];
  const db = await openDb();
  if (db) await exec(db, 'DELETE FROM reminders');
}

export async function logEvent(label: string, detail = '') {
  const createdAt = new Date().toISOString();
  rememberLocalEvent(label, detail);
  const db = await openDb();
  if (!db) return;
  try {
    await exec(db, 'INSERT INTO events (label, detail, createdAt) VALUES (?, ?, ?)', [label, detail, createdAt]);
  } catch (error) {
    lastDbOpenError = error instanceof Error ? error.message : String(error || 'log event failed');
    rememberLocalEvent('db.event.error', lastDbOpenError);
  }
}

export async function listEvents(limit = 20) {
  const db = await openDb();
  if (!db) return memoryFallback.events.slice(-limit).reverse();
  return all<{ label: string; detail: string; createdAt: string }>(db, 'SELECT label, detail, createdAt FROM events ORDER BY id DESC LIMIT ?', [limit])
    .catch(() => memoryFallback.events.slice(-limit).reverse());
}

async function getStorageEstimate(db: SQLiteDatabase | null) {
  if (!db) return { pageCount: 0, pageSize: 0, estimatedBytes: 0 };
  try {
    const pageCountRow = await first<any>(db, 'PRAGMA page_count;');
    const pageSizeRow = await first<any>(db, 'PRAGMA page_size;');
    const pageCount = Number(pageCountRow?.page_count ?? Object.values(pageCountRow ?? {})[0] ?? 0);
    const pageSize = Number(pageSizeRow?.page_size ?? Object.values(pageSizeRow ?? {})[0] ?? 0);
    return { pageCount, pageSize, estimatedBytes: pageCount * pageSize };
  } catch {
    return { pageCount: 0, pageSize: 0, estimatedBytes: 0 };
  }
}

export async function compactEventLogIfIdle(maxRows = 300) {
  const db = await openDb();
  if (!db) return { compacted: false, deleted: 0 };
  let deleted = 0;
  try {
    const row = await first<{ c: number }>(db, 'SELECT COUNT(*) as c FROM events');
    let extra = Math.max(0, (row?.c ?? 0) - maxRows);
    while (extra > 0) {
      const batch = Math.min(100, extra);
      await exec(db, 'DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY id ASC LIMIT ?)', [batch]);
      deleted += batch;
      extra -= batch;
    }
    if (deleted > 0) await exec(db, 'PRAGMA wal_checkpoint(TRUNCATE);');
    return { compacted: deleted > 0, deleted };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'event compact failed');
    rememberLocalEvent('db.compact.error', message);
    return { compacted: false, deleted };
  }
}

export async function getDiagnostics() {
  const db = await openDb();
  const prefs = await loadPreferences();
  const [messageCount, memoryCount, eventCount, reminderCount] = db
    ? await Promise.all([
        first<{ c: number }>(db, 'SELECT COUNT(*) as c FROM messages'),
        first<{ c: number }>(db, 'SELECT COUNT(*) as c FROM memories'),
        first<{ c: number }>(db, 'SELECT COUNT(*) as c FROM events'),
        first<{ c: number }>(db, 'SELECT COUNT(*) as c FROM reminders WHERE delivered = 0'),
      ]).catch(() => [{ c: memoryFallback.messages.length }, { c: memoryFallback.memories.length }, { c: memoryFallback.events.length }, { c: memoryFallback.reminders.filter((r) => !r.delivered).length }])
    : [{ c: memoryFallback.messages.length }, { c: memoryFallback.memories.length }, { c: memoryFallback.events.length }, { c: memoryFallback.reminders.filter((r) => !r.delivered).length }];
  const storage = await getStorageEstimate(db);
  return {
    sqliteAvailable: !!db,
    dbOpenRetries,
    lastDbOpenError,
    storageEstimateBytes: storage.estimatedBytes,
    storagePageCount: storage.pageCount,
    storagePageSize: storage.pageSize,
    persona: getPersona(prefs.persona).label,
    wakePhrase: prefs.wakePhrase,
    brainMode: prefs.brainMode,
    voiceLocale: prefs.voiceLocale,
    messages: messageCount?.c ?? 0,
    memories: memoryCount?.c ?? 0,
    events: eventCount?.c ?? 0,
    pendingReminders: reminderCount?.c ?? 0,
    proactiveReminders: prefs.proactiveReminders,
  };
}
