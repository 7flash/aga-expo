export type BrowserVoicePhase =
  | 'idle'
  | 'wake'
  | 'command'
  | 'thinking'
  | 'speaking'
  | 'live_session';

export type BrowserVoiceState = {
  phase: BrowserVoicePhase;
  reason: string;
  updatedAt: number;
  wakeMutedUntil: number;
  commandActiveUntil: number;
  thinkingActiveUntil: number;
  speakingActiveUntil: number;
  liveSessionActiveUntil: number;
  lastWakeAt: number;
  lastTranscript: string;
  lastReply: string;
};

const KEY = '__AGA_BROWSER_VOICE_STATE_V16';
const LEGACY_KEY = '__AGA_BROWSER_VOICE_STATE_V15';

function now() {
  return Date.now();
}

function defaultState(): BrowserVoiceState {
  return {
    phase: 'idle',
    reason: '',
    updatedAt: now(),
    wakeMutedUntil: 0,
    commandActiveUntil: 0,
    thinkingActiveUntil: 0,
    speakingActiveUntil: 0,
    liveSessionActiveUntil: 0,
    lastWakeAt: 0,
    lastTranscript: '',
    lastReply: '',
  };
}

function root(): any {
  return globalThis as any;
}

function publish() {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('aga:browserVoiceState', { detail: getBrowserVoiceState() }));
  } catch {}
}

function normalizeState(raw: Partial<BrowserVoiceState> | undefined): BrowserVoiceState {
  return { ...defaultState(), ...(raw || {}) } as BrowserVoiceState;
}

export function getBrowserVoiceState(): BrowserVoiceState {
  const g = root();
  if (!g[KEY]) {
    g[KEY] = normalizeState(g[LEGACY_KEY]);
    try { delete g[LEGACY_KEY]; } catch {}
  }
  return g[KEY];
}

export function resetBrowserVoiceState(reason = 'reset') {
  const g = root();
  g[KEY] = defaultState();
  g[KEY].reason = reason;

  if (typeof window !== 'undefined') {
    (window as any).__AGA_POST_WAKE_ACTIVE = false;
    (window as any).__AGA_TTS_ACTIVE = false;
    (window as any).__AGA_LIVE_SESSION_ACTIVE = false;
  }

  publish();
  return g[KEY] as BrowserVoiceState;
}

export function setBrowserVoicePhase(phase: BrowserVoicePhase, reason = '', ttlMs = 0) {
  const state = getBrowserVoiceState();
  const t = now();

  state.phase = phase;
  state.reason = reason;
  state.updatedAt = t;

  if (phase === 'wake') state.lastWakeAt = t;
  if (phase === 'command') state.commandActiveUntil = Math.max(state.commandActiveUntil, t + (ttlMs || 11000));
  if (phase === 'thinking') state.thinkingActiveUntil = Math.max(state.thinkingActiveUntil, t + (ttlMs || 12000));
  if (phase === 'speaking') state.speakingActiveUntil = Math.max(state.speakingActiveUntil, t + (ttlMs || 45000));
  if (phase === 'live_session') state.liveSessionActiveUntil = Math.max(state.liveSessionActiveUntil, t + (ttlMs || 5 * 60_000));

  publish();
  return state;
}

export function markWakeDetected(reason = 'wake') {
  const state = setBrowserVoicePhase('wake', reason, 0);
  state.lastWakeAt = now();
  state.wakeMutedUntil = Math.max(state.wakeMutedUntil, now() + 900);
  publish();
  return state;
}

export function markCommandActive(reason = 'command', ttlMs = 11000) {
  if (typeof window !== 'undefined') (window as any).__AGA_POST_WAKE_ACTIVE = true;
  return setBrowserVoicePhase('command', reason, ttlMs);
}

export function markThinking(reason = 'thinking', ttlMs = 14000) {
  return setBrowserVoicePhase('thinking', reason, ttlMs);
}

export function markSpeaking(reason = 'speaking', ttlMs = 45000) {
  if (typeof window !== 'undefined') (window as any).__AGA_TTS_ACTIVE = true;
  return setBrowserVoicePhase('speaking', reason, ttlMs);
}

export function markLiveSessionActive(reason = 'live session', ttlMs = 5 * 60_000) {
  if (typeof window !== 'undefined') (window as any).__AGA_LIVE_SESSION_ACTIVE = true;
  return setBrowserVoicePhase('live_session', reason, ttlMs);
}

export function extendLiveSession(reason = 'live session active', ttlMs = 5 * 60_000) {
  const state = getBrowserVoiceState();
  state.reason = reason;
  state.updatedAt = now();
  state.liveSessionActiveUntil = Math.max(state.liveSessionActiveUntil, now() + ttlMs);
  if (state.phase === 'idle') state.phase = 'live_session';
  if (typeof window !== 'undefined') (window as any).__AGA_LIVE_SESSION_ACTIVE = true;
  publish();
  return state;
}

export function markLiveSessionDone(reason = 'live session done') {
  const state = getBrowserVoiceState();
  state.liveSessionActiveUntil = 0;
  state.wakeMutedUntil = Math.max(state.wakeMutedUntil, now() + 1700);
  if (state.phase === 'live_session') state.phase = 'idle';
  state.reason = reason;
  state.updatedAt = now();
  if (typeof window !== 'undefined') (window as any).__AGA_LIVE_SESSION_ACTIVE = false;
  publish();
  return state;
}

export function markIdle(reason = 'idle') {
  const state = getBrowserVoiceState();

  state.phase = 'idle';
  state.reason = reason;
  state.updatedAt = now();
  state.commandActiveUntil = 0;
  state.thinkingActiveUntil = 0;

  if (typeof window !== 'undefined') {
    (window as any).__AGA_POST_WAKE_ACTIVE = false;
  }

  publish();
  return state;
}

export function markTtsDone(reason = 'tts done') {
  const state = getBrowserVoiceState();

  state.speakingActiveUntil = 0;
  state.wakeMutedUntil = Math.max(state.wakeMutedUntil, now() + 1700);
  state.phase = state.liveSessionActiveUntil > now() ? 'live_session' : 'idle';
  state.reason = reason;
  state.updatedAt = now();

  if (typeof window !== 'undefined') {
    (window as any).__AGA_TTS_ACTIVE = false;
  }

  publish();
  return state;
}

export function muteWakeFor(ms: number, reason = 'muted') {
  const state = getBrowserVoiceState();

  state.wakeMutedUntil = Math.max(state.wakeMutedUntil, now() + Math.max(0, ms));
  state.reason = reason;
  state.updatedAt = now();

  publish();
  return state;
}

export function noteTranscript(text: string) {
  const state = getBrowserVoiceState();

  state.lastTranscript = String(text || '').trim();
  state.updatedAt = now();

  publish();
  return state;
}

export function noteReply(text: string) {
  const state = getBrowserVoiceState();

  state.lastReply = String(text || '').trim();
  state.updatedAt = now();

  publish();
  return state;
}

export function browserVoiceIsActuallyBusy() {
  if (typeof window !== 'undefined') {
    if ((window as any).__AGA_POST_WAKE_ACTIVE || (window as any).__AGA_TTS_ACTIVE || (window as any).__AGA_LIVE_SESSION_ACTIVE) return true;
  }

  const state = getBrowserVoiceState();
  const t = now();

  return (
    t < state.wakeMutedUntil ||
    t < state.commandActiveUntil ||
    t < state.thinkingActiveUntil ||
    t < state.speakingActiveUntil ||
    t < state.liveSessionActiveUntil ||
    state.phase === 'command' ||
    state.phase === 'thinking' ||
    state.phase === 'speaking' ||
    state.phase === 'live_session'
  );
}

export function browserVoiceShouldIgnoreWake() {
  return browserVoiceIsActuallyBusy();
}

export function browserVoicePhaseLabel() {
  const state = getBrowserVoiceState();
  const t = now();

  if (typeof window !== 'undefined' && (window as any).__AGA_TTS_ACTIVE) return 'SPEAKING';
  if (typeof window !== 'undefined' && (window as any).__AGA_POST_WAKE_ACTIVE) return 'COMMAND WINDOW';
  if (typeof window !== 'undefined' && (window as any).__AGA_LIVE_SESSION_ACTIVE) return 'LIVE SESSION';

  if (t < state.liveSessionActiveUntil || state.phase === 'live_session') return 'LIVE SESSION';
  if (t < state.speakingActiveUntil || state.phase === 'speaking') return 'SPEAKING';
  if (t < state.thinkingActiveUntil || state.phase === 'thinking') return 'THINKING';
  if (t < state.commandActiveUntil || state.phase === 'command') return 'COMMAND WINDOW';
  if (state.phase === 'wake') return 'WAKE DETECTED';

  return '';
}

declare global {
  interface Window {
    __AGA_POST_WAKE_ACTIVE?: boolean;
    __AGA_TTS_ACTIVE?: boolean;
    __AGA_LIVE_SESSION_ACTIVE?: boolean;
    __AGA_BROWSER_VOICE_STATE?: () => BrowserVoiceState;
    __AGA_RESET_VOICE_STATE?: () => BrowserVoiceState;
  }
}

if (typeof window !== 'undefined') {
  (window as any).__AGA_BROWSER_VOICE_STATE = getBrowserVoiceState;
  (window as any).__AGA_RESET_VOICE_STATE = () => resetBrowserVoiceState('manual reset');
}
