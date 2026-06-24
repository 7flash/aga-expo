import { measured } from '../measure';

export type AgaMode =
  | 'idle'
  | 'armed'
  | 'wake_confirmed'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'playing_media'
  | 'translating'
  | 'agent_running'
  | 'recovering'
  | 'offline';

export type AgaEvent =
  | { type: 'boot' }
  | { type: 'wake'; phrase?: string }
  | { type: 'speech_start' }
  | { type: 'speech_end'; text?: string }
  | { type: 'turn_start' }
  | { type: 'reply_ready' }
  | { type: 'speech_start_output' }
  | { type: 'speech_done' }
  | { type: 'media_start' }
  | { type: 'media_stop' }
  | { type: 'translate_start' }
  | { type: 'translate_stop' }
  | { type: 'agent_start' }
  | { type: 'agent_done' }
  | { type: 'barge_in' }
  | { type: 'recover'; reason?: string }
  | { type: 'offline' }
  | { type: 'online' }
  | { type: 'timeout' }
  | { type: 'cancel' };

export type AgaStateSnapshot = {
  mode: AgaMode;
  activeUntil: number;
  lastWakeAt: number | null;
  lastEventAt: number;
  lastEvent: string;
  lastRecovery: string | null;
  translationTarget: string | null;
  mediaProvider: 'youtube' | 'music' | null;
  conversationId: number | null;
};

export const DEFAULT_ACTIVE_WINDOW_MS = 35_000;

export function createInitialAgaState(now = Date.now()): AgaStateSnapshot {
  return {
    mode: 'idle',
    activeUntil: 0,
    lastWakeAt: null,
    lastEventAt: now,
    lastEvent: 'boot',
    lastRecovery: null,
    translationTarget: null,
    mediaProvider: null,
    conversationId: null,
  };
}

const transitions: Record<AgaMode, Partial<Record<AgaEvent['type'], AgaMode>>> = {
  idle: {
    boot: 'armed',
    wake: 'wake_confirmed',
    translate_start: 'translating',
    media_start: 'playing_media',
    offline: 'offline',
    recover: 'recovering',
  },
  armed: {
    wake: 'wake_confirmed',
    speech_start: 'listening',
    translate_start: 'translating',
    media_start: 'playing_media',
    offline: 'offline',
    recover: 'recovering',
  },
  wake_confirmed: {
    speech_start: 'listening',
    speech_end: 'thinking',
    turn_start: 'thinking',
    timeout: 'armed',
    cancel: 'armed',
    offline: 'offline',
    recover: 'recovering',
  },
  listening: {
    speech_end: 'thinking',
    turn_start: 'thinking',
    timeout: 'armed',
    cancel: 'armed',
    translate_start: 'translating',
    offline: 'offline',
    recover: 'recovering',
  },
  thinking: {
    reply_ready: 'speaking',
    media_start: 'playing_media',
    translate_start: 'translating',
    agent_start: 'agent_running',
    timeout: 'recovering',
    cancel: 'armed',
    offline: 'offline',
    recover: 'recovering',
  },
  speaking: {
    speech_done: 'armed',
    barge_in: 'listening',
    media_start: 'playing_media',
    translate_start: 'translating',
    cancel: 'armed',
    offline: 'offline',
    recover: 'recovering',
  },
  playing_media: {
    media_stop: 'armed',
    wake: 'wake_confirmed',
    speech_start: 'listening',
    translate_start: 'translating',
    cancel: 'armed',
    offline: 'offline',
    recover: 'recovering',
  },
  translating: {
    translate_stop: 'armed',
    barge_in: 'listening',
    speech_start: 'listening',
    cancel: 'armed',
    offline: 'offline',
    recover: 'recovering',
  },
  agent_running: {
    agent_done: 'speaking',
    cancel: 'armed',
    offline: 'offline',
    recover: 'recovering',
    timeout: 'recovering',
  },
  recovering: {
    online: 'armed',
    wake: 'wake_confirmed',
    cancel: 'armed',
    timeout: 'armed',
    offline: 'offline',
  },
  offline: {
    online: 'armed',
    wake: 'wake_confirmed',
    recover: 'recovering',
  },
};

export function reduceAgaState(
  state: AgaStateSnapshot,
  event: AgaEvent,
  now = Date.now(),
  activeWindowMs = DEFAULT_ACTIVE_WINDOW_MS
): AgaStateSnapshot {
  const nextMode = transitions[state.mode]?.[event.type] ?? state.mode;
  const next: AgaStateSnapshot = {
    ...state,
    mode: nextMode,
    lastEvent: event.type,
    lastEventAt: now,
  };

  if (event.type === 'wake') {
    next.lastWakeAt = now;
    next.activeUntil = now + activeWindowMs;
  }

  if (event.type === 'speech_start' || event.type === 'speech_end' || event.type === 'barge_in') {
    next.activeUntil = Math.max(next.activeUntil, now + activeWindowMs);
  }

  if (event.type === 'translate_start') {
    next.translationTarget = next.translationTarget ?? 'English';
    next.activeUntil = now + activeWindowMs;
  }

  if (event.type === 'translate_stop' || event.type === 'cancel') {
    next.translationTarget = null;
  }

  if (event.type === 'media_start') {
    next.mediaProvider = next.mediaProvider ?? 'music';
  }

  if (event.type === 'media_stop' || event.type === 'cancel') {
    next.mediaProvider = null;
  }

  if (event.type === 'recover') {
    next.lastRecovery = event.reason ?? 'unknown recovery';
  }

  if (event.type === 'timeout' && now > state.activeUntil) {
    next.activeUntil = 0;
  }

  return next;
}

export async function measuredTransition(state: AgaStateSnapshot, event: AgaEvent) {
  return measured('aga.state.transition', async () => reduceAgaState(state, event), {
    from: state.mode,
    event: event.type,
  });
}

export function isActive(state: AgaStateSnapshot, now = Date.now()) {
  return state.mode !== 'idle' && state.mode !== 'offline' && now < state.activeUntil;
}

export function stateLabel(mode: AgaMode) {
  switch (mode) {
    case 'armed':
      return 'Listening for wake phrase';
    case 'wake_confirmed':
      return 'Wake confirmed';
    case 'listening':
      return 'Listening';
    case 'thinking':
      return 'Thinking';
    case 'speaking':
      return 'Speaking';
    case 'playing_media':
      return 'Playing media';
    case 'translating':
      return 'Translating';
    case 'agent_running':
      return 'Agent running';
    case 'recovering':
      return 'Recovering';
    case 'offline':
      return 'Offline';
    default:
      return 'Idle';
  }
}
