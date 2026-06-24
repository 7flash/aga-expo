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
};

let dbPromise: Promise<SQLiteDatabase | null> | null = null;
let memoryFallback = {
  prefs: { ...DEFAULT_PREFS },
  messages: [] as Array<{ role: string; content: string; createdAt: string }>,
  memories: [] as Array<{ text: string; createdAt: string }>,
  events: [] as Array<{ label: string; detail: string; createdAt: string }>,
};

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
  })();
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
  const db = await openDb();
  if (!db) return { sqliteAvailable: false };
  await exec(db, `CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);`);
  await exec(db, `CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, content TEXT NOT NULL, createdAt TEXT NOT NULL);`);
  await exec(db, `CREATE TABLE IF NOT EXISTS memories (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, createdAt TEXT NOT NULL);`);
  await exec(db, `CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, detail TEXT NOT NULL, createdAt TEXT NOT NULL);`);
  const prefs = await loadPreferences();
  await savePreferences({ ...DEFAULT_PREFS, ...prefs });
  return { sqliteAvailable: true };
}

export async function loadPreferences(): Promise<Preferences> {
  const db = await openDb();
  if (!db) return { ...memoryFallback.prefs };
  const rows = await all<{ key: string; value: string }>(db, 'SELECT key, value FROM preferences');
  const prefs: any = { ...DEFAULT_PREFS };
  for (const row of rows) {
    try { prefs[row.key] = JSON.parse(row.value); } catch { prefs[row.key] = row.value; }
  }
  return prefs;
}

export async function savePreferences(input: Partial<Preferences>) {
  const next = { ...(await loadPreferences()), ...input } as Preferences;
  memoryFallback.prefs = next;
  const db = await openDb();
  if (!db) return next;
  for (const [key, value] of Object.entries(next)) {
    await exec(db, 'INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
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
  ).then((rows) => rows.reverse());
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
    );
  }
  return all<{ text: string; createdAt: string }>(db, 'SELECT text, createdAt FROM memories ORDER BY id DESC LIMIT ?', [limit]);
}

export async function logEvent(label: string, detail = '') {
  const createdAt = new Date().toISOString();
  memoryFallback.events.push({ label, detail, createdAt });
  memoryFallback.events = memoryFallback.events.slice(-60);
  const db = await openDb();
  if (db) await exec(db, 'INSERT INTO events (label, detail, createdAt) VALUES (?, ?, ?)', [label, detail, createdAt]);
}

export async function listEvents(limit = 20) {
  const db = await openDb();
  if (!db) return memoryFallback.events.slice(-limit).reverse();
  return all<{ label: string; detail: string; createdAt: string }>(db, 'SELECT label, detail, createdAt FROM events ORDER BY id DESC LIMIT ?', [limit]);
}

export async function getDiagnostics() {
  const db = await openDb();
  const prefs = await loadPreferences();
  const [messageCount, memoryCount, eventCount] = db
    ? await Promise.all([
        first<{ c: number }>(db, 'SELECT COUNT(*) as c FROM messages'),
        first<{ c: number }>(db, 'SELECT COUNT(*) as c FROM memories'),
        first<{ c: number }>(db, 'SELECT COUNT(*) as c FROM events'),
      ])
    : [{ c: memoryFallback.messages.length }, { c: memoryFallback.memories.length }, { c: memoryFallback.events.length }];
  return {
    sqliteAvailable: !!db,
    persona: getPersona(prefs.persona).label,
    wakePhrase: prefs.wakePhrase,
    brainMode: prefs.brainMode,
    voiceLocale: prefs.voiceLocale,
    messages: messageCount?.c ?? 0,
    memories: memoryCount?.c ?? 0,
    events: eventCount?.c ?? 0,
  };
}
