export type ChatRole = 'user' | 'assistant' | 'system';

export type Conversation = {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: number;
  conversationId: number;
  role: ChatRole;
  content: string;
  createdAt: string;
};

export type UserPreferences = {
  id: 1;
  activePersona: string;
  wakePhrase: string;
  speechRate: number;
  pitch: number;
  translateTargetLang: string | null;
  backendMode: 'offline' | 'openai-direct' | 'gemini-direct' | 'remote';
  openaiApiKey: string | null;
  geminiApiKey: string | null;
  openaiModel: string;
  geminiModel: string;
  remoteBackendUrl: string | null;
  remoteBackendToken: string | null;
  voiceLocale: string;
  firstRunComplete: number;
  speechWatchdogEnabled: number;
  proactiveEnabled: number;
  localNotificationsEnabled: number;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
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

export type ReminderRow = {
  id: number;
  title: string;
  dueAt: string;
  status: 'pending' | 'fired' | 'cancelled';
  source: 'voice' | 'settings';
  notificationId: string | null;
  createdAt: string;
  updatedAt: string;
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

export type EventLog = {
  id: number;
  kind: string;
  label: string;
  payload: string | null;
  durationMs: number | null;
  createdAt: string;
};
