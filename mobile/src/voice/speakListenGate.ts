export type SpeakListenGateSnapshot = {
  outputActive: boolean;
  activeSpeakerId: string | null;
  captureBlockedUntil: number;
  reason: string;
  updatedAt: number;
};

type Listener = (snapshot: SpeakListenGateSnapshot) => void;

const root = globalThis as any;
const KEY = '__AGA_SPEAK_LISTEN_GATE__';

type GateState = {
  snapshot: SpeakListenGateSnapshot;
  listeners: Set<Listener>;
};

function createState(): GateState {
  return {
    snapshot: {
      outputActive: false,
      activeSpeakerId: null,
      captureBlockedUntil: 0,
      reason: 'idle',
      updatedAt: Date.now(),
    },
    listeners: new Set<Listener>(),
  };
}

function state(): GateState {
  if (!root[KEY]) root[KEY] = createState();
  return root[KEY] as GateState;
}

function publish(patch: Partial<SpeakListenGateSnapshot>) {
  const s = state();
  s.snapshot = { ...s.snapshot, ...patch, updatedAt: Date.now() };
  for (const listener of Array.from(s.listeners)) listener(s.snapshot);
  try {
    root.dispatchEvent?.(new CustomEvent('aga:speakListenGate', { detail: s.snapshot }));
  } catch {}
}

export function subscribeSpeakListenGate(listener: Listener) {
  const s = state();
  s.listeners.add(listener);
  listener(s.snapshot);
  return () => s.listeners.delete(listener);
}

export function getSpeakListenGateSnapshot(): SpeakListenGateSnapshot {
  return state().snapshot;
}

export function beginAssistantSpeech(reason = 'assistant_speaking') {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  publish({ outputActive: true, activeSpeakerId: id, captureBlockedUntil: Date.now() + 60_000, reason });
  return id;
}

export function endAssistantSpeech(id?: string | null, settleMs = 700) {
  const current = getSpeakListenGateSnapshot();
  if (id && current.activeSpeakerId && current.activeSpeakerId !== id) return;
  publish({ outputActive: false, activeSpeakerId: null, captureBlockedUntil: Date.now() + Math.max(0, settleMs), reason: 'speech_settling' });
}

export function abortAssistantSpeech(reason = 'speech_aborted') {
  publish({ outputActive: false, activeSpeakerId: null, captureBlockedUntil: Date.now() + 500, reason });
}

export function blockCapture(ms: number, reason = 'capture_blocked') {
  publish({ captureBlockedUntil: Math.max(getSpeakListenGateSnapshot().captureBlockedUntil, Date.now() + Math.max(0, ms)), reason });
}

export function isAssistantOutputActive() {
  return getSpeakListenGateSnapshot().outputActive;
}

export function shouldBlockUserCapture() {
  const snap = getSpeakListenGateSnapshot();
  return snap.outputActive || Date.now() < snap.captureBlockedUntil;
}

export function captureBlockedMs() {
  const snap = getSpeakListenGateSnapshot();
  if (snap.outputActive) return Math.max(0, snap.captureBlockedUntil - Date.now());
  return Math.max(0, snap.captureBlockedUntil - Date.now());
}
