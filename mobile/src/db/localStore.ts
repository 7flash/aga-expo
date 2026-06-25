type MaybeStorage = {
  getItem?: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
};

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
    kind: 'language' | 'imagination' | 'advice' | 'general';
    label: string;
    targetLanguage?: string | null;
    theme?: string | null;
    startedAt: string;
  } | null;
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
  brainMode: ((process.env.EXPO_PUBLIC_AGA_BRAIN_MODE as Preferences['brainMode']) || 'openai') as Preferences['brainMode'],
  translateTarget: null,
  showDiagnostics: false,
  proactiveReminders: true,
  realtimeVoice: process.env.EXPO_PUBLIC_AGA_REALTIME_VOICE || process.env.EXPO_PUBLIC_OPENAI_REALTIME_VOICE || 'marin',
  personalityPrompt: null,
  activeSession: null,
};

const STORAGE_KEY = 'aga.mobile.localStore.v11';

let store: StoreShape = {
  preferences: { ...DEFAULT_PREFS },
  messages: [],
  memories: [],
  reminders: [],
  events: [],
};
let initialized = false;

function storage(): MaybeStorage | null {
  const root: any = globalThis as any;
  return root?.localStorage ?? null;
}

function isoNow() {
  return new Date().toISOString();
}

function readPersisted() {
  if (initialized) return;
  initialized = true;
  try {
    const raw = storage()?.getItem?.(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    store = {
      preferences: { ...DEFAULT_PREFS, ...(parsed?.preferences ?? {}) },
      messages: Array.isArray(parsed?.messages) ? parsed.messages : [],
      memories: Array.isArray(parsed?.memories) ? parsed.memories : [],
      reminders: Array.isArray(parsed?.reminders) ? parsed.reminders : [],
      events: Array.isArray(parsed?.events) ? parsed.events : [],
    };
  } catch {
    // Keep in-memory defaults if persistence is unavailable/corrupt.
  }
}

function persist() {
  try {
    storage()?.setItem?.(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore quota/native-webview storage failures. AGA should keep running.
  }
}

export async function initializeLocalStore() {
  readPersisted();
  persist();
  return { sqliteAvailable: false, fallback: 'memory-web-storage' };
}

export async function loadPreferences(): Promise<Preferences> {
  readPersisted();
  store.preferences = { ...DEFAULT_PREFS, ...store.preferences };
  return { ...store.preferences };
}

export async function savePreferences(input: Partial<Preferences>) {
  readPersisted();
  store.preferences = { ...store.preferences, ...input };
  persist();
  return { ...store.preferences };
}

export async function addMessage(role: 'user' | 'assistant' | string, content: string) {
  readPersisted();
  const clean = String(content ?? '').trim();
  if (!clean) return;
  store.messages.push({ role, content: clean, createdAt: isoNow() });
  store.messages = store.messages.slice(-120);
  persist();
}

export async function listMessages(limit = 20) {
  readPersisted();
  return store.messages.slice(-limit);
}

export async function clearMessages() {
  readPersisted();
  store.messages = [];
  persist();
}

export async function addMemory(text: string) {
  readPersisted();
  const clean = String(text ?? '').trim();
  if (!clean) return;
  store.memories.push({ text: clean, createdAt: isoNow() });
  store.memories = store.memories.slice(-200);
  persist();
}

export async function searchMemories(query?: string, limit = 8) {
  readPersisted();
  const q = query?.trim().toLowerCase();
  return store.memories
    .filter((item) => !q || item.text.toLowerCase().includes(q))
    .slice(-limit)
    .reverse();
}

export async function addReminder(text: string, dueAt: string, notificationId?: string | null): Promise<Reminder> {
  readPersisted();
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
  persist();
  return reminder;
}

export async function listPendingReminders(limit = 8) {
  readPersisted();
  return store.reminders
    .filter((reminder) => !reminder.delivered)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .slice(0, limit);
}

export async function drainDueReminders(now = new Date()) {
  readPersisted();
  const nowIso = now.toISOString();
  const due = store.reminders.filter((reminder) => !reminder.delivered && reminder.dueAt <= nowIso);
  if (due.length) {
    const dueIds = new Set(due.map((reminder) => reminder.id));
    store.reminders = store.reminders.map((reminder) => dueIds.has(reminder.id) ? { ...reminder, delivered: 1 } : reminder);
    persist();
  }
  return due;
}

export async function clearReminders() {
  readPersisted();
  store.reminders = [];
  persist();
}

export async function logEvent(label: string, detail = '') {
  readPersisted();
  store.events.push({ label: String(label), detail: String(detail ?? ''), createdAt: isoNow() });
  store.events = store.events.slice(-500);
  persist();
}

export async function compactEventLogIfIdle() {
  readPersisted();
  if (store.events.length > 250) {
    store.events = store.events.slice(-250);
    persist();
  }
}

export async function getDiagnostics() {
  readPersisted();
  return {
    messages: store.messages.length,
    memories: store.memories.length,
    pendingReminders: store.reminders.filter((reminder) => !reminder.delivered).length,
    reminders: store.reminders.length,
    events: store.events.length,
    sqliteAvailable: false,
  };
}
