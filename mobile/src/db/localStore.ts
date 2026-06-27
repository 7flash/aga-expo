import { all, first, run, transaction } from './sqlite';
import { migrate } from './migrations';

type MaybeJson = Record<string, unknown> | null | undefined;

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
    kind: 'language' | 'imagination' | 'advice' | 'focus' | 'bedtime' | 'breathing' | 'music' | 'general' | 'remote';
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
  realtimeListenMode?: 'strict' | 'answer_window' | 'handsfree';
  allowBargeIn?: boolean;
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
  currentConversation?: {
    id: string;
    startedAt: string;
    reason: string;
    generation: number;
    dbId?: number;
  } | null;
  forgetConfirmation?: {
    scope: 'session' | 'personalization' | 'everything';
    requestedAt: string;
    expiresAt: string;
  } | null;
  userProfile?: unknown;
};

export type Reminder = {
  id: number;
  text: string;
  dueAt: string;
  delivered: number;
  createdAt: string;
  notificationId?: string | null;
};

export type ResetScope = 'session' | 'personalization' | 'everything';

const DEFAULT_PREFS: Preferences = {
  wakePhrase: process.env.EXPO_PUBLIC_AGA_WAKE_PHRASE || process.env.EXPO_PUBLIC_AGA_WAKE_WORD || 'aga',
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
  currentConversation: null,
  forgetConfirmation: null,
  userProfile: undefined,
};

type MemoryState = {
  preferences: Preferences;
  messages: Array<{ role: string; content: string; createdAt: string }>;
  memories: Array<{ id: number; text: string; createdAt: string; kind?: string; source?: string; confidence?: number }>;
  reminders: Reminder[];
  events: Array<{ label: string; detail: string; createdAt: string }>;
};

let memory: MemoryState = {
  preferences: { ...DEFAULT_PREFS },
  messages: [],
  memories: [],
  reminders: [],
  events: [],
};

let initialized = false;
let sqliteAvailable = false;
let lastPersistenceError: string | null = null;
let storageBackend: 'sqlite-relational' | 'memory-fallback' = 'memory-fallback';
let currentPrefs: Preferences = { ...DEFAULT_PREFS };

function isoNow() {
  return new Date().toISOString();
}

function bool(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return /^(1|true|yes|on)$/i.test(value);
  return fallback;
}

function safeJson<T>(raw: unknown, fallback: T): T {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function asJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function newConversationId() {
  return `aga-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function mapBackendMode(value: unknown): Preferences['brainMode'] {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('gemini')) return 'gemini';
  if (raw.includes('offline')) return 'offline';
  if (raw.includes('openai')) return 'openai';
  return 'realtime';
}

function toPreferenceCore(prefs: Preferences) {
  const backendMode = prefs.brainMode === 'gemini'
    ? 'gemini-direct'
    : prefs.brainMode === 'offline'
      ? 'offline'
      : prefs.brainMode === 'openai'
        ? 'openai-direct'
        : 'openai-direct';
  return [
    prefs.persona || DEFAULT_PREFS.persona,
    prefs.wakePhrase || DEFAULT_PREFS.wakePhrase,
    prefs.translateTarget ?? null,
    backendMode,
    prefs.openaiApiKey || null,
    prefs.geminiApiKey || null,
    prefs.remoteConfigUrl ?? null,
    prefs.voiceLocale || DEFAULT_PREFS.voiceLocale,
    prefs.proactiveReminders === false ? 0 : 1,
  ];
}

function prefsExtra(prefs: Preferences) {
  const {
    wakePhrase,
    persona,
    voiceLocale,
    openaiApiKey,
    geminiApiKey,
    brainMode,
    translateTarget,
    proactiveReminders,
    ...extra
  } = prefs;
  return extra;
}

async function bootSqlite() {
  if (initialized) return sqliteAvailable;
  initialized = true;
  try {
    await migrate();
    sqliteAvailable = true;
    storageBackend = 'sqlite-relational';
    currentPrefs = await readPreferencesFromSqlite();
    return true;
  } catch (error) {
    sqliteAvailable = false;
    storageBackend = 'memory-fallback';
    lastPersistenceError = error instanceof Error ? error.message : String(error || 'sqlite unavailable');
    currentPrefs = { ...memory.preferences };
    return false;
  }
}

async function ensureReady() {
  await bootSqlite();
}

async function readPreferencesFromSqlite(): Promise<Preferences> {
  const core = await first<any>('SELECT * FROM user_preferences WHERE id = 1');
  const extraRow = await first<{ json: string }>('SELECT json FROM aga_preferences_extra WHERE id = 1');
  const extra = safeJson<Record<string, unknown>>(extraRow?.json, {});
  const prefs: Preferences = {
    ...DEFAULT_PREFS,
    ...(extra as Partial<Preferences>),
    wakePhrase: String(core?.wakePhrase || extra.wakePhrase || DEFAULT_PREFS.wakePhrase),
    persona: String(core?.activePersona || extra.persona || DEFAULT_PREFS.persona),
    voiceLocale: String(core?.voiceLocale || extra.voiceLocale || DEFAULT_PREFS.voiceLocale),
    openaiApiKey: String(core?.openaiApiKey || extra.openaiApiKey || DEFAULT_PREFS.openaiApiKey || ''),
    geminiApiKey: String(core?.geminiApiKey || extra.geminiApiKey || DEFAULT_PREFS.geminiApiKey || ''),
    brainMode: mapBackendMode(core?.backendMode || extra.brainMode || DEFAULT_PREFS.brainMode),
    translateTarget: core?.translateTargetLang ?? (extra.translateTarget as string | null | undefined) ?? null,
    proactiveReminders: bool(core?.proactiveEnabled, true),
  };
  return prefs;
}

async function writePreferencesToSqlite(prefs: Preferences) {
  const core = toPreferenceCore(prefs);
  await run(
    `UPDATE user_preferences
       SET activePersona = ?, wakePhrase = ?, translateTargetLang = ?, backendMode = ?, openaiApiKey = ?, geminiApiKey = ?, remoteBackendUrl = ?, voiceLocale = ?, proactiveEnabled = ?, updatedAt = CURRENT_TIMESTAMP
     WHERE id = 1`,
    core,
  );
  await run(
    `INSERT OR REPLACE INTO aga_preferences_extra (id, json, updatedAt) VALUES (1, ?, CURRENT_TIMESTAMP)`,
    [asJson(prefsExtra(prefs))],
  );
}

async function ensureConversationRow(reason = 'implicit') {
  await ensureReady();
  if (!sqliteAvailable) return null;
  const current = currentPrefs.currentConversation;
  if (current?.dbId) return current.dbId;
  const title = reason === 'implicit' ? 'AGA voice session' : `AGA ${reason}`.slice(0, 80);
  const result: any = await run('INSERT INTO conversations (title, createdAt, updatedAt) VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)', [title]);
  const row = await first<{ id: number }>('SELECT id FROM conversations ORDER BY id DESC LIMIT 1');
  const dbId = Number(result?.lastInsertRowId ?? result?.insertId ?? row?.id ?? 1);
  currentPrefs = {
    ...currentPrefs,
    currentConversation: {
      id: current?.id || newConversationId(),
      startedAt: current?.startedAt || isoNow(),
      reason,
      generation: current?.generation ?? 1,
      dbId,
    },
  };
  await writePreferencesToSqlite(currentPrefs);
  return dbId;
}

function preserveTechnicalPrefs(prefs: Preferences): Partial<Preferences> {
  return {
    wakePhrase: prefs.wakePhrase || DEFAULT_PREFS.wakePhrase,
    voiceLocale: prefs.voiceLocale || DEFAULT_PREFS.voiceLocale,
    openaiApiKey: prefs.openaiApiKey || DEFAULT_PREFS.openaiApiKey,
    geminiApiKey: prefs.geminiApiKey || DEFAULT_PREFS.geminiApiKey,
    brainMode: prefs.brainMode || DEFAULT_PREFS.brainMode,
    translateTarget: null,
    showDiagnostics: !!prefs.showDiagnostics,
    proactiveReminders: prefs.proactiveReminders !== false,
    realtimeListenMode: prefs.realtimeListenMode || DEFAULT_PREFS.realtimeListenMode,
    allowBargeIn: !!prefs.allowBargeIn,
    mediaDuckingEnabled: prefs.mediaDuckingEnabled !== false,
    remoteConfigRevision: prefs.remoteConfigRevision ?? null,
    remoteConfigUrl: prefs.remoteConfigUrl ?? DEFAULT_PREFS.remoteConfigUrl ?? null,
    remoteConfigPollMs: prefs.remoteConfigPollMs ?? DEFAULT_PREFS.remoteConfigPollMs ?? null,
    deviceLabel: prefs.deviceLabel ?? DEFAULT_PREFS.deviceLabel ?? null,
    serverLabels: prefs.serverLabels ?? {},
    serverImages: prefs.serverImages ?? {},
    homeLatitude: prefs.homeLatitude ?? null,
    homeLongitude: prefs.homeLongitude ?? null,
    homeLabel: prefs.homeLabel ?? null,
    temperatureUnit: prefs.temperatureUnit || DEFAULT_PREFS.temperatureUnit,
  };
}

function memoryNextConversation(reason: string) {
  const previousGeneration = memory.preferences.currentConversation?.generation ?? 0;
  return {
    id: newConversationId(),
    startedAt: isoNow(),
    reason: String(reason || 'new_session'),
    generation: previousGeneration + 1,
  };
}

export async function flushLocalStore(reason = 'flush') {
  void reason;
  if (sqliteAvailable) await writePreferencesToSqlite(currentPrefs);
}

export async function initializeLocalStore() {
  const ok = await bootSqlite();
  return { sqliteAvailable: ok, fallback: ok ? 'sqlite-relational' : 'memory-fallback' };
}

export async function loadPreferences(options: { forceReload?: boolean } = {}): Promise<Preferences> {
  await ensureReady();
  if (!sqliteAvailable) return { ...memory.preferences };
  if (options.forceReload) currentPrefs = await readPreferencesFromSqlite();
  return { ...currentPrefs };
}

export async function savePreferences(input: Partial<Preferences>) {
  await ensureReady();
  if (!sqliteAvailable) {
    memory.preferences = { ...memory.preferences, ...input };
    currentPrefs = { ...memory.preferences };
    return { ...memory.preferences };
  }
  currentPrefs = { ...currentPrefs, ...input };
  await writePreferencesToSqlite(currentPrefs);
  return { ...currentPrefs };
}

export async function addMessage(role: 'user' | 'assistant' | string, content: string) {
  const clean = String(content ?? '').trim();
  if (!clean) return;
  await ensureReady();
  if (!sqliteAvailable) {
    memory.messages.push({ role, content: clean, createdAt: isoNow() });
    memory.messages = memory.messages.slice(-160);
    return;
  }
  const conversationId = await ensureConversationRow('message');
  await run('INSERT INTO messages (conversationId, role, content, createdAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP)', [conversationId, role, clean]);
}

export async function listMessages(limit = 20) {
  await ensureReady();
  if (!sqliteAvailable) return memory.messages.slice(-limit);
  const conversationId = currentPrefs.currentConversation?.dbId;
  if (!conversationId) return [];
  const rows = await all<{ role: string; content: string; createdAt: string }>(
    'SELECT role, content, createdAt FROM messages WHERE conversationId = ? ORDER BY id DESC LIMIT ?',
    [conversationId, limit],
  );
  return rows.reverse();
}

export async function clearMessages() {
  await ensureReady();
  if (!sqliteAvailable) {
    memory.messages = [];
    return;
  }
  const conversationId = currentPrefs.currentConversation?.dbId;
  if (conversationId) await run('DELETE FROM messages WHERE conversationId = ?', [conversationId]);
}

export async function startNewConversationSession(
  reason = 'manual',
  options: { clearTranscript?: boolean; endActiveSession?: boolean; clearTranslate?: boolean } = {},
) {
  await ensureReady();
  if (!sqliteAvailable) {
    memory.preferences = {
      ...memory.preferences,
      currentConversation: memoryNextConversation(reason),
      forgetConfirmation: null,
      translateTarget: options.clearTranslate === false ? memory.preferences.translateTarget : null,
      activeSession: options.endActiveSession ? null : memory.preferences.activeSession ?? null,
    };
    if (options.clearTranscript !== false) memory.messages = [];
    currentPrefs = { ...memory.preferences };
    return { ...memory.preferences.currentConversation! };
  }
  const previousGeneration = currentPrefs.currentConversation?.generation ?? 0;
  const result: any = await run('INSERT INTO conversations (title, createdAt, updatedAt) VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)', [`AGA ${reason}`.slice(0, 80)]);
  const row = await first<{ id: number }>('SELECT id FROM conversations ORDER BY id DESC LIMIT 1');
  const dbId = Number(result?.lastInsertRowId ?? result?.insertId ?? row?.id ?? 1);
  currentPrefs = {
    ...currentPrefs,
    currentConversation: {
      id: newConversationId(),
      startedAt: isoNow(),
      reason: String(reason || 'new_session'),
      generation: previousGeneration + 1,
      dbId,
    },
    forgetConfirmation: null,
    translateTarget: options.clearTranslate === false ? currentPrefs.translateTarget : null,
    activeSession: options.endActiveSession ? null : currentPrefs.activeSession ?? null,
  };
  await writePreferencesToSqlite(currentPrefs);
  return { ...currentPrefs.currentConversation! };
}

export async function requestForgetConfirmation(scope: ResetScope = 'everything', ttlMs = 60_000) {
  const requestedAt = isoNow();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const prefs = await savePreferences({ forgetConfirmation: { scope, requestedAt, expiresAt } });
  return { ...prefs.forgetConfirmation! };
}

export async function getForgetConfirmation(scope?: ResetScope) {
  const prefs = await loadPreferences();
  const pending = prefs.forgetConfirmation ?? null;
  if (!pending) return null;
  if (pending.expiresAt <= isoNow()) {
    await savePreferences({ forgetConfirmation: null });
    return null;
  }
  if (scope && pending.scope !== scope) return null;
  return { ...pending };
}

export async function clearForgetConfirmation() {
  await savePreferences({ forgetConfirmation: null });
}

export async function resetAgaData(scope: ResetScope = 'everything') {
  await ensureReady();
  const cleanScope: ResetScope = scope === 'session' || scope === 'personalization' || scope === 'everything' ? scope : 'everything';

  if (cleanScope === 'session') {
    const conversation = await startNewConversationSession('forget_session', { clearTranscript: true, endActiveSession: true });
    return { scope: cleanScope, conversation, messages: 0, memories: await countMemories(), reminders: await countReminders() };
  }

  const preserved = preserveTechnicalPrefs(await loadPreferences());
  const nextPrefs: Preferences = {
    ...DEFAULT_PREFS,
    ...preserved,
    persona: DEFAULT_PREFS.persona,
    realtimeVoice: DEFAULT_PREFS.realtimeVoice,
    personalityPrompt: null,
    activeSession: null,
    currentConversation: null,
    forgetConfirmation: null,
    userProfile: undefined,
  } as Preferences;

  if (!sqliteAvailable) {
    memory.preferences = { ...nextPrefs, currentConversation: memoryNextConversation(`forget_${cleanScope}`) };
    memory.messages = [];
    memory.memories = [];
    memory.events = [];
    if (cleanScope === 'everything') memory.reminders = [];
    currentPrefs = { ...memory.preferences };
    return { scope: cleanScope, conversation: memory.preferences.currentConversation, messages: 0, memories: 0, reminders: memory.reminders.length };
  }

  await transaction(async () => {
    await run('DELETE FROM messages');
    await run('DELETE FROM conversations');
    await run('DELETE FROM memory_facts');
    await run('DELETE FROM episodic_reflections');
    await run('DELETE FROM routines');
    await run('DELETE FROM learned_skills WHERE source = ?', ['learned']);
    await run('DELETE FROM event_log');
    if (cleanScope === 'everything') await run('DELETE FROM reminders');
  });
  currentPrefs = nextPrefs;
  await writePreferencesToSqlite(currentPrefs);
  const conversation = await startNewConversationSession(`forget_${cleanScope}`, { clearTranscript: true, endActiveSession: true });
  return { scope: cleanScope, conversation, messages: 0, memories: 0, reminders: await countReminders() };
}

export async function addMemory(text: string, options: { kind?: string; source?: string; confidence?: number } = {}) {
  const clean = String(text ?? '').trim();
  if (!clean) return;
  await ensureReady();
  const kind = String(options.kind || 'user_fact');
  const rawSource = String(options.source || 'voice');
  const source = rawSource === 'voice' || rawSource === 'settings' || rawSource === 'assistant' ? rawSource : 'assistant';
  const confidence = Number.isFinite(options.confidence) ? Number(options.confidence) : 1;
  if (!sqliteAvailable) {
    memory.memories.push({ id: Date.now(), text: clean, createdAt: isoNow(), kind, source, confidence });
    memory.memories = memory.memories.slice(-1000);
    return;
  }
  await run(
    'INSERT INTO memory_facts (text, kind, source, confidence, pinned, createdAt, updatedAt) VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
    [clean, kind, source, confidence],
  );
}

function ftsQuery(query: string) {
  return query.trim().split(/\s+/).filter(Boolean).map((part) => `${part.replace(/["']/g, '')}*`).join(' ');
}

export async function searchMemories(query?: string, limit = 8) {
  await ensureReady();
  const q = query?.trim();
  if (!sqliteAvailable) {
    const lower = q?.toLowerCase();
    return memory.memories
      .filter((item) => !lower || item.text.toLowerCase().includes(lower))
      .slice(-limit)
      .reverse();
  }
  if (q) {
    try {
      return await all<{ id: number; text: string; createdAt: string; kind: string; source: string; confidence: number }>(
        `SELECT mf.id, mf.text, mf.createdAt, mf.kind, mf.source, mf.confidence
           FROM memory_facts_fts fts
           JOIN memory_facts mf ON mf.id = fts.rowid
          WHERE memory_facts_fts MATCH ?
          ORDER BY bm25(memory_facts_fts), mf.pinned DESC, mf.updatedAt DESC
          LIMIT ?`,
        [ftsQuery(q), limit],
      );
    } catch {
      const like = `%${q.replace(/[%_]/g, '')}%`;
      return all('SELECT id, text, createdAt, kind, source, confidence FROM memory_facts WHERE text LIKE ? ORDER BY pinned DESC, updatedAt DESC LIMIT ?', [like, limit]);
    }
  }
  return all('SELECT id, text, createdAt, kind, source, confidence FROM memory_facts ORDER BY pinned DESC, updatedAt DESC LIMIT ?', [limit]);
}

export async function addReminder(text: string, dueAt: string, notificationId?: string | null): Promise<Reminder> {
  const clean = String(text ?? '').trim();
  await ensureReady();
  if (!sqliteAvailable) {
    const reminder: Reminder = { id: Date.now() + Math.floor(Math.random() * 1000), text: clean, dueAt, delivered: 0, createdAt: isoNow(), notificationId: notificationId ?? null };
    memory.reminders.push(reminder);
    memory.reminders.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    return reminder;
  }
  const result: any = await run(
    'INSERT INTO reminders (title, dueAt, status, source, notificationId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
    [clean, dueAt, 'pending', 'voice', notificationId ?? null],
  );
  const row = await first<any>('SELECT * FROM reminders WHERE id = COALESCE(?, (SELECT MAX(id) FROM reminders))', [result?.lastInsertRowId ?? result?.insertId ?? null]);
  return mapReminder(row);
}

function mapReminder(row: any): Reminder {
  return {
    id: Number(row.id),
    text: String(row.title ?? row.text ?? ''),
    dueAt: String(row.dueAt),
    delivered: row.status === 'pending' ? 0 : 1,
    createdAt: String(row.createdAt ?? isoNow()),
    notificationId: row.notificationId ?? null,
  };
}

export async function listPendingReminders(limit = 8) {
  await ensureReady();
  if (!sqliteAvailable) {
    return memory.reminders.filter((reminder) => !reminder.delivered).sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, limit);
  }
  const rows = await all<any>('SELECT * FROM reminders WHERE status = ? ORDER BY dueAt ASC LIMIT ?', ['pending', limit]);
  return rows.map(mapReminder);
}

export async function drainDueReminders(now = new Date()) {
  await ensureReady();
  const nowIso = now.toISOString();
  if (!sqliteAvailable) {
    const due = memory.reminders.filter((reminder) => !reminder.delivered && reminder.dueAt <= nowIso);
    if (due.length) {
      const ids = new Set(due.map((reminder) => reminder.id));
      memory.reminders = memory.reminders.map((reminder) => ids.has(reminder.id) ? { ...reminder, delivered: 1 } : reminder);
    }
    return due;
  }
  const due = (await all<any>('SELECT * FROM reminders WHERE status = ? AND dueAt <= ? ORDER BY dueAt ASC', ['pending', nowIso])).map(mapReminder);
  if (due.length) await run(`UPDATE reminders SET status = 'fired', updatedAt = CURRENT_TIMESTAMP WHERE id IN (${due.map(() => '?').join(',')})`, due.map((item) => item.id));
  return due;
}

export async function clearReminders() {
  await ensureReady();
  if (!sqliteAvailable) {
    memory.reminders = [];
    return;
  }
  await run("UPDATE reminders SET status = 'cancelled', updatedAt = CURRENT_TIMESTAMP WHERE status = 'pending'");
}

export async function logEvent(label: string, detail = '') {
  await ensureReady();
  if (!sqliteAvailable) {
    memory.events.push({ label: String(label), detail: String(detail ?? ''), createdAt: isoNow() });
    memory.events = memory.events.slice(-700);
    return;
  }
  await run('INSERT INTO event_log (kind, label, payload, createdAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP)', [String(label || 'event'), String(label || 'event'), String(detail ?? '')]);
}

export async function compactEventLogIfIdle() {
  await ensureReady();
  if (!sqliteAvailable) {
    if (memory.events.length > 300) memory.events = memory.events.slice(-300);
    return;
  }
  await run('DELETE FROM event_log WHERE id NOT IN (SELECT id FROM event_log ORDER BY id DESC LIMIT 500)');
}

async function countMemories() {
  if (!sqliteAvailable) return memory.memories.length;
  const row = await first<{ count: number }>('SELECT COUNT(*) AS count FROM memory_facts');
  return Number(row?.count ?? 0);
}

async function countReminders() {
  if (!sqliteAvailable) return memory.reminders.length;
  const row = await first<{ count: number }>('SELECT COUNT(*) AS count FROM reminders');
  return Number(row?.count ?? 0);
}

export async function getDiagnostics() {
  await ensureReady();
  const messages = sqliteAvailable ? Number((await first<{ count: number }>('SELECT COUNT(*) AS count FROM messages'))?.count ?? 0) : memory.messages.length;
  const memories = await countMemories();
  const reminders = await countReminders();
  const pendingReminders = sqliteAvailable
    ? Number((await first<{ count: number }>("SELECT COUNT(*) AS count FROM reminders WHERE status = 'pending'"))?.count ?? 0)
    : memory.reminders.filter((reminder) => !reminder.delivered).length;
  const events = sqliteAvailable ? Number((await first<{ count: number }>('SELECT COUNT(*) AS count FROM event_log'))?.count ?? 0) : memory.events.length;
  const routines = sqliteAvailable ? Number((await first<{ count: number }>('SELECT COUNT(*) AS count FROM routines'))?.count ?? 0) : 0;
  const reflections = sqliteAvailable ? Number((await first<{ count: number }>('SELECT COUNT(*) AS count FROM episodic_reflections'))?.count ?? 0) : 0;
  const learnedSkills = sqliteAvailable ? Number((await first<{ count: number }>('SELECT COUNT(*) AS count FROM learned_skills'))?.count ?? 0) : 0;
  return {
    messages,
    memories,
    pendingReminders,
    reminders,
    events,
    routines,
    reflections,
    learnedSkills,
    sqliteAvailable,
    storageBackend,
    lastPersistenceError,
    persistPending: false,
    persistDirtyReason: null,
    currentConversation: currentPrefs.currentConversation ?? null,
    forgetConfirmationPending: !!currentPrefs.forgetConfirmation,
  } as any;
}

export async function addEpisodicReflection(input: {
  summary: string;
  sessionId?: string | null;
  kind?: string;
  goal?: string | null;
  technique?: string | null;
  emotionalPattern?: string | null;
  nextRitual?: string | null;
  tags?: string[];
}) {
  await ensureReady();
  const summary = String(input.summary ?? '').trim();
  if (!summary) return null;
  if (!sqliteAvailable) {
    await addMemory(summary, { kind: 'effective_technique', source: 'reflection', confidence: 0.8 });
    return null;
  }
  await run(
    `INSERT INTO episodic_reflections (sessionId, kind, summary, goal, technique, emotionalPattern, nextRitual, tagsJson, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      input.sessionId ?? currentPrefs.currentConversation?.id ?? null,
      input.kind || 'reflection',
      summary,
      input.goal ?? null,
      input.technique ?? null,
      input.emotionalPattern ?? null,
      input.nextRitual ?? null,
      asJson(input.tags ?? []),
    ],
  );
  return first('SELECT * FROM episodic_reflections ORDER BY id DESC LIMIT 1');
}

export async function upsertLearnedRoutine(input: {
  title: string;
  prompt: string;
  timeOfDay?: string | null;
  daysOfWeek?: string | null;
  trigger?: MaybeJson;
  action?: MaybeJson;
  confidence?: number;
  consentState?: 'proposed' | 'accepted' | 'dismissed';
}) {
  await ensureReady();
  const title = String(input.title || 'Learned routine').trim();
  const prompt = String(input.prompt || title).trim();
  if (!sqliteAvailable) return null;
  await run(
    `INSERT INTO routines (title, prompt, timeOfDay, daysOfWeek, triggerJson, actionJson, confidence, source, enabled, consentState, lastObservedAt, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'learned', 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [title, prompt, input.timeOfDay ?? 'any', input.daysOfWeek ?? null, input.trigger ? asJson(input.trigger) : null, input.action ? asJson(input.action) : null, input.confidence ?? 0.55, input.consentState || 'proposed'],
  );
  return first('SELECT * FROM routines ORDER BY id DESC LIMIT 1');
}

export async function listProposedRoutines(limit = 5) {
  await ensureReady();
  if (!sqliteAvailable) return [];
  return all('SELECT * FROM routines WHERE enabled = 1 AND consentState = ? ORDER BY confidence DESC, updatedAt DESC LIMIT ?', ['proposed', limit]);
}