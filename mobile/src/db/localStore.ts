declare function require(name: string): any;

type MaybeStorage = {
  getItem?: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
};

type SQLiteDatabase = any;

export type Preferences = {
  wakePhrase: string;
  persona: string;
  voiceLocale: string;
  openaiApiKey: string;
  geminiApiKey: string;
  brainMode: 'offline' | 'openai' | 'gemini' | 'realtime';
  translateTarget: string | null;
  showDiagnostics: boolean;
  proactiveReminders: boolean;
  realtimeVoice?: string | null;
  personalityPrompt?: string | null;
  activeSession?: {
    kind: 'language' | 'imagination' | 'advice' | 'focus' | 'bedtime' | 'breathing' | 'music' | 'general'
    | 'remote';
    label: string;
    targetLanguage?: string | null;
    theme?: string | null;
    skillId?: string | null;
    instructions?: string | null;
    iconUrl?: string | null;
    imageUrl?: string | null;
    toolNames?: string[];
    startedAt: string;
  } | null;
  /**
   * strict: require AGA/Angel wake unless AGA is waiting for a short answer.
   * answer_window: same as strict, with a longer answer window after direct questions.
   * handsfree: process natural speech during the active realtime session.
   */
  realtimeListenMode?: 'strict' | 'answer_window' | 'handsfree';
  /** Whether speech detected while AGA is speaking can interrupt her response. */
  allowBargeIn?: boolean;
  /** Whether background media ducks while AGA speaks. */
  mediaDuckingEnabled?: boolean;
  remoteConfigRevision?: string | null;
  remoteConfigUrl?: string | null;
  remoteConfigPollMs?: number | null;
  deviceLabel?: string | null;
  serverLabels?: Record<string, string>;
  serverImages?: Record<string, string>;
  homeLatitude?: number | null;
  homeLongitude?: number | null;
  homeLabel?: string | null;
  temperatureUnit?: 'celsius' | 'fahrenheit';
};

export type Reminder = {
  id: number;
  text: string;
  dueAt: string;
  delivered: number;
  createdAt: string;
  notificationId?: string | null;
};

type StoreShape = {
  preferences: Preferences;
  messages: Array<{ role: 'user' | 'assistant' | string; content: string; createdAt: string }>;
  memories: Array<{ text: string; createdAt: string }>;
  reminders: Reminder[];
  events: Array<{ label: string; detail: string; createdAt: string }>;
};

const DEFAULT_PREFS: Preferences = {
  wakePhrase: 'hey aga',
  persona: 'warm',
  voiceLocale: 'en-US',
  openaiApiKey: process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? '',
  geminiApiKey: process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '',
  brainMode: ((process.env.EXPO_PUBLIC_AGA_BRAIN_MODE as Preferences['brainMode']) || 'realtime') as Preferences['brainMode'],
  translateTarget: null,
  showDiagnostics: false,
  proactiveReminders: true,
  realtimeVoice: process.env.EXPO_PUBLIC_AGA_REALTIME_VOICE || process.env.EXPO_PUBLIC_OPENAI_REALTIME_VOICE || 'marin',
  personalityPrompt: null,
  activeSession: null,
  realtimeListenMode: 'strict',
  allowBargeIn: false,
  mediaDuckingEnabled: true,
  remoteConfigRevision: null,
  remoteConfigUrl: process.env.EXPO_PUBLIC_AGA_CONFIG_URL || process.env.EXPO_PUBLIC_TRADJS_CONFIG_URL || null,
  remoteConfigPollMs: Number(process.env.EXPO_PUBLIC_AGA_CONFIG_POLL_MS || 60_000),
  deviceLabel: process.env.EXPO_PUBLIC_AGA_DEVICE_LABEL || null,
  serverLabels: {},
  serverImages: {},
  homeLatitude: process.env.EXPO_PUBLIC_AGA_HOME_LATITUDE ? Number(process.env.EXPO_PUBLIC_AGA_HOME_LATITUDE) : null,
  homeLongitude: process.env.EXPO_PUBLIC_AGA_HOME_LONGITUDE ? Number(process.env.EXPO_PUBLIC_AGA_HOME_LONGITUDE) : null,
  homeLabel: process.env.EXPO_PUBLIC_AGA_HOME_LABEL || null,
  temperatureUnit: (process.env.EXPO_PUBLIC_AGA_TEMPERATURE_UNIT as any) || 'celsius',
};

const STORAGE_KEY = 'aga.mobile.localStore.v20';
const LEGACY_KEYS = ['aga.mobile.localStore.v18', 'aga.mobile.localStore.v11'];
const SQLITE_DB = 'aga-local-kv.db';

let store: StoreShape = {
  preferences: { ...DEFAULT_PREFS },
  messages: [],
  memories: [],
  reminders: [],
  events: [],
};
let initialized = false;
let sqliteDbPromise: Promise<SQLiteDatabase | null> | null = null;
let sqliteAvailable = false;
let lastPersistenceError: string | null = null;
let storageBackend: 'memory' | 'web-storage' | 'sqlite' = 'memory';
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistDirtyReason = '';
const PERSIST_DEBOUNCE_MS = Number(process.env.EXPO_PUBLIC_AGA_STORE_DEBOUNCE_MS || 250);

function storage(): MaybeStorage | null {
  const root: any = globalThis as any;
  return root?.localStorage ?? null;
}

function isoNow() {
  return new Date().toISOString();
}

function parseStore(raw: string | null | undefined): StoreShape | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return {
      preferences: { ...DEFAULT_PREFS, ...(parsed?.preferences ?? {}) },
      messages: Array.isArray(parsed?.messages) ? parsed.messages : [],
      memories: Array.isArray(parsed?.memories) ? parsed.memories : [],
      reminders: Array.isArray(parsed?.reminders) ? parsed.reminders : [],
      events: Array.isArray(parsed?.events) ? parsed.events : [],
    };
  } catch {
    return null;
  }
}

function serializeStore() {
  return JSON.stringify(store);
}

async function importSQLite() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-sqlite');
  } catch {
    return null;
  }
}

async function openSqlite(): Promise<SQLiteDatabase | null> {
  if (sqliteDbPromise) return sqliteDbPromise;
  sqliteDbPromise = (async () => {
    const SQLite = await importSQLite();
    if (!SQLite) return null;
    const anySQLite = SQLite as any;
    let db: SQLiteDatabase | null = null;
    if (typeof anySQLite.openDatabaseAsync === 'function') db = await anySQLite.openDatabaseAsync(SQLITE_DB);
    else if (typeof anySQLite.openDatabaseSync === 'function') db = anySQLite.openDatabaseSync(SQLITE_DB);
    else if (typeof anySQLite.openDatabase === 'function') db = anySQLite.openDatabase(SQLITE_DB);
    if (!db) return null;
    await sqlExec(db, 'CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updatedAt TEXT NOT NULL);');
    sqliteAvailable = true;
    return db;
  })().catch((error) => {
    lastPersistenceError = error instanceof Error ? error.message : String(error || 'sqlite open failed');
    sqliteAvailable = false;
    sqliteDbPromise = null;
    return null;
  });
  return sqliteDbPromise;
}

async function sqlExec(db: SQLiteDatabase | null, sql: string, params: unknown[] = []) {
  if (!db) return;
  if (typeof db.runAsync === 'function') return db.runAsync(sql, params as any[]);
  if (typeof db.execAsync === 'function' && params.length === 0) return db.execAsync(sql);
  if (typeof db.transaction === 'function') {
    return new Promise<void>((resolve, reject) => {
      db.transaction((tx: any) => {
        tx.executeSql(sql, params as any[], () => resolve(), (_: any, error: any) => { reject(error); return false; });
      });
    });
  }
}

async function sqlFirst<T = any>(db: SQLiteDatabase | null, sql: string, params: unknown[] = []): Promise<T | null> {
  if (!db) return null;
  if (typeof db.getFirstAsync === 'function') return db.getFirstAsync(sql, params as any[]);
  if (typeof db.getAllAsync === 'function') {
    const rows = await db.getAllAsync(sql, params as any[]);
    return rows?.[0] ?? null;
  }
  if (typeof db.transaction === 'function') {
    return new Promise<T | null>((resolve, reject) => {
      db.transaction((tx: any) => {
        tx.executeSql(sql, params as any[], (_: any, result: any) => resolve(result.rows?._array?.[0] ?? null), (_: any, error: any) => { reject(error); return false; });
      });
    });
  }
  return null;
}

function readWebStorageOnce() {
  const s = storage();
  if (!s) return false;
  for (const key of [STORAGE_KEY, ...LEGACY_KEYS]) {
    const parsed = parseStore(s.getItem?.(key));
    if (parsed) {
      store = parsed;
      storageBackend = 'web-storage';
      return true;
    }
  }
  return false;
}

async function readSqliteOnce() {
  const db = await openSqlite();
  if (!db) return false;
  const row = await sqlFirst<{ value: string }>(db, 'SELECT value FROM kv WHERE key = ?', [STORAGE_KEY]);
  const parsed = parseStore(row?.value);
  if (parsed) {
    store = parsed;
    storageBackend = 'sqlite';
    return true;
  }
  return false;
}

function persistWebStorage() {
  try {
    storage()?.setItem?.(STORAGE_KEY, serializeStore());
  } catch (error) {
    lastPersistenceError = error instanceof Error ? error.message : String(error || 'web storage persist failed');
  }
}

async function persistSqlite() {
  try {
    const db = await openSqlite();
    if (!db) return;
    await sqlExec(db, 'INSERT OR REPLACE INTO kv (key, value, updatedAt) VALUES (?, ?, ?)', [STORAGE_KEY, serializeStore(), isoNow()]);
    storageBackend = 'sqlite';
  } catch (error) {
    lastPersistenceError = error instanceof Error ? error.message : String(error || 'sqlite persist failed');
  }
}

function persistNow(reason = 'immediate') {
  persistDirtyReason = reason;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistWebStorage();
  void persistSqlite();
}

function persist(reason = 'change') {
  persistDirtyReason = reason;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistWebStorage();
    void persistSqlite();
  }, PERSIST_DEBOUNCE_MS);
}

export async function flushLocalStore(reason = 'flush') {
  persistDirtyReason = reason;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistWebStorage();
  await persistSqlite();
}

function ensureRead() {
  if (initialized) return;
  initialized = true;
  readWebStorageOnce();
}

export async function initializeLocalStore() {
  if (!initialized) {
    initialized = true;
    const webLoaded = readWebStorageOnce();
    const sqliteLoaded = await readSqliteOnce();
    if (!webLoaded && !sqliteLoaded) store.preferences = { ...DEFAULT_PREFS, ...store.preferences };
  }
  store.preferences = { ...DEFAULT_PREFS, ...store.preferences };
  persist('initialize');
  return { sqliteAvailable, fallback: sqliteAvailable ? 'sqlite-kv' : storage() ? 'web-storage' : 'memory' };
}

export async function loadPreferences(): Promise<Preferences> {
  ensureRead();
  store.preferences = { ...DEFAULT_PREFS, ...store.preferences };
  return { ...store.preferences };
}

export async function savePreferences(input: Partial<Preferences>) {
  ensureRead();
  store.preferences = { ...store.preferences, ...input };
  persistNow('preferences');
  return { ...store.preferences };
}

export async function addMessage(role: 'user' | 'assistant' | string, content: string) {
  ensureRead();
  const clean = String(content ?? '').trim();
  if (!clean) return;
  store.messages.push({ role, content: clean, createdAt: isoNow() });
  store.messages = store.messages.slice(-160);
  persist('message');
}

export async function listMessages(limit = 20) {
  ensureRead();
  return store.messages.slice(-limit);
}

export async function clearMessages() {
  ensureRead();
  store.messages = [];
  persist('clear_messages');
}

export async function addMemory(text: string) {
  ensureRead();
  const clean = String(text ?? '').trim();
  if (!clean) return;
  store.memories.push({ text: clean, createdAt: isoNow() });
  store.memories = store.memories.slice(-300);
  persist('memory');
}

export async function searchMemories(query?: string, limit = 8) {
  ensureRead();
  const q = query?.trim().toLowerCase();
  return store.memories
    .filter((item) => !q || item.text.toLowerCase().includes(q))
    .slice(-limit)
    .reverse();
}

export async function addReminder(text: string, dueAt: string, notificationId?: string | null): Promise<Reminder> {
  ensureRead();
  const reminder: Reminder = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    text: String(text ?? '').trim(),
    dueAt,
    delivered: 0,
    createdAt: isoNow(),
    notificationId: notificationId ?? null,
  };
  store.reminders.push(reminder);
  store.reminders.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  persistNow('reminder');
  return reminder;
}

export async function listPendingReminders(limit = 8) {
  ensureRead();
  return store.reminders
    .filter((reminder) => !reminder.delivered)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .slice(0, limit);
}

export async function drainDueReminders(now = new Date()) {
  ensureRead();
  const nowIso = now.toISOString();
  const due = store.reminders.filter((reminder) => !reminder.delivered && reminder.dueAt <= nowIso);
  if (due.length) {
    const dueIds = new Set(due.map((reminder) => reminder.id));
    store.reminders = store.reminders.map((reminder) => dueIds.has(reminder.id) ? { ...reminder, delivered: 1 } : reminder);
    persistNow('drain_reminders');
  }
  return due;
}

export async function clearReminders() {
  ensureRead();
  store.reminders = [];
  persistNow('clear_reminders');
}

export async function logEvent(label: string, detail = '') {
  ensureRead();
  store.events.push({ label: String(label), detail: String(detail ?? ''), createdAt: isoNow() });
  store.events = store.events.slice(-700);
  persist('event');
}

export async function compactEventLogIfIdle() {
  ensureRead();
  if (store.events.length > 300) {
    store.events = store.events.slice(-300);
    persist('compact_event_log');
  }
}

export async function getDiagnostics() {
  ensureRead();
  return {
    messages: store.messages.length,
    memories: store.memories.length,
    pendingReminders: store.reminders.filter((reminder) => !reminder.delivered).length,
    reminders: store.reminders.length,
    events: store.events.length,
    sqliteAvailable,
    storageBackend,
    lastPersistenceError,
    persistPending: !!persistTimer,
    persistDirtyReason,
  } as any;
}
