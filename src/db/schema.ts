export type Role = 'user' | 'assistant' | 'system';

export type Conversation = {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: number;
  conversationId: number;
  role: Role;
  content: string;
  createdAt: string;
};

export type UserPreferences = {
  id: number;
  activePersona: string;
  wakePhrase: string;
  speechRate: number;
  pitch: number;
  translateTargetLang: string | null;
  backendMode: 'offline' | 'openai-direct' | 'gemini-direct';
  openaiApiKey: string | null;
  geminiApiKey: string | null;
  openaiModel: string;
  geminiModel: string;
  proactiveEnabled: number;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  updatedAt: string;
};

export type EventLog = {
  id: number;
  kind: string;
  label: string;
  payload: string | null;
  durationMs: number | null;
  createdAt: string;
};

export type MediaSession = {
  id: number;
  kind: 'youtube' | 'music';
  title: string;
  artist: string | null;
  query: string;
  ref: string | null;
  artworkUrl: string | null;
  state: 'playing' | 'paused' | 'stopped';
  createdAt: string;
  updatedAt: string;
};

export type MemoryFact = {
  id: number;
  text: string;
  source: 'voice' | 'assistant' | 'settings';
  pinned: number;
  createdAt: string;
  updatedAt: string;
};

export type ReminderStatus = 'pending' | 'fired' | 'cancelled';

export type Reminder = {
  id: number;
  title: string;
  dueAt: string;
  status: ReminderStatus;
  source: 'voice' | 'settings';
  createdAt: string;
  updatedAt: string;
};

export type ProactiveEvent = {
  id: number;
  kind: 'reminder' | 'routine' | 'agent' | 'system';
  speech: string;
  payload: string | null;
  status: 'queued' | 'spoken' | 'dismissed';
  createdAt: string;
  updatedAt: string;
};

export function nowIso() {
  return new Date().toISOString();
}
