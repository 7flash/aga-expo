export type VoiceTelemetryPhase =
  | 'idle'
  | 'wake_listening'
  | 'hearing_audio'
  | 'wake_detected'
  | 'command_window'
  | 'capturing_user'
  | 'transcribing'
  | 'thinking'
  | 'tool_call'
  | 'speaking'
  | 'live_session'
  | 'guided_session'
  | 'media'
  | 'recovering'
  | 'error';

export type VoiceTelemetryEvent = {
  at?: number;
  phase?: VoiceTelemetryPhase;
  platform?: 'web' | 'android' | 'ios' | 'unknown';
  wakeEngine?: 'volume' | 'sherpa_wasm' | 'sherpa_native' | 'porcupine' | 'disabled' | string;
  provider?: string;
  micOpen?: boolean;
  assistantSpeaking?: boolean;
  commandWindowActive?: boolean;
  canAcceptUserSpeech?: boolean;
  rms?: number;
  peak?: number;
  audioLevel?: number;
  frames?: number;
  wakeKeyword?: string;
  wakeConfidence?: number;
  transcript?: string;
  sttText?: string;
  reply?: string;
  status?: string;
  error?: string;
  raw?: unknown;
};

export type VoiceTelemetrySnapshot = {
  at: number;
  phase: VoiceTelemetryPhase;
  platform: 'web' | 'android' | 'ios' | 'unknown';
  wakeEngine: string;
  provider: string;
  micOpen: boolean;
  assistantSpeaking: boolean;
  commandWindowActive: boolean;
  canAcceptUserSpeech: boolean;
  rms: number;
  peak: number;
  audioLevel: number;
  frames: number;
  wakeKeyword: string;
  wakeConfidence: number;
  transcript: string;
  sttText: string;
  reply: string;
  status: string;
  error: string;
  events: VoiceTelemetryEvent[];
  waveform: number[];
};

type Listener = (snapshot: VoiceTelemetrySnapshot) => void;

const listeners = new Set<Listener>();
const events: VoiceTelemetryEvent[] = [];
const waveform: number[] = Array.from({ length: 48 }, () => 0);

let snapshot: VoiceTelemetrySnapshot = {
  at: Date.now(),
  phase: 'wake_listening',
  platform: typeof navigator !== 'undefined' ? 'web' : 'unknown',
  wakeEngine: 'unknown',
  provider: 'unknown',
  micOpen: true,
  assistantSpeaking: false,
  commandWindowActive: false,
  canAcceptUserSpeech: true,
  rms: 0,
  peak: 0,
  audioLevel: 0,
  frames: 0,
  wakeKeyword: '',
  wakeConfidence: 0,
  transcript: '',
  sttText: '',
  reply: '',
  status: 'ready',
  error: '',
  events,
  waveform,
};

function clamp01(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function inferMicOpen(next: Partial<VoiceTelemetrySnapshot>) {
  if (typeof next.micOpen === 'boolean') return next.micOpen;
  if (typeof next.canAcceptUserSpeech === 'boolean') return next.canAcceptUserSpeech;
  if (typeof next.assistantSpeaking === 'boolean' && next.assistantSpeaking) return false;
  if (next.phase === 'speaking' || next.phase === 'thinking' || next.phase === 'tool_call' || next.phase === 'transcribing') return false;
  if (next.phase === 'live_session') return true;
  return snapshot.micOpen;
}

function pushWaveValue(value: number) {
  const clean = clamp01(value);
  waveform.push(clean);
  while (waveform.length > 48) waveform.shift();
}

function notify() {
  for (const listener of Array.from(listeners)) {
    try { listener(snapshot); } catch {}
  }
}

export function publishVoiceTelemetry(event: VoiceTelemetryEvent = {}) {
  const at = event.at ?? Date.now();
  const audioLevel = event.audioLevel != null
    ? clamp01(event.audioLevel)
    : event.rms != null
      ? clamp01(Number(event.rms) * 12)
      : event.peak != null
        ? clamp01(Number(event.peak) * 5)
        : snapshot.audioLevel;

  if (event.rms != null || event.peak != null || event.audioLevel != null) pushWaveValue(audioLevel);

  const nextPartial: Partial<VoiceTelemetrySnapshot> = {
    ...snapshot,
    at,
    phase: event.phase ?? snapshot.phase,
    platform: event.platform ?? snapshot.platform,
    wakeEngine: event.wakeEngine ?? snapshot.wakeEngine,
    provider: event.provider ?? snapshot.provider,
    assistantSpeaking: event.assistantSpeaking ?? snapshot.assistantSpeaking,
    commandWindowActive: event.commandWindowActive ?? snapshot.commandWindowActive,
    canAcceptUserSpeech: event.canAcceptUserSpeech ?? snapshot.canAcceptUserSpeech,
    rms: event.rms != null ? clamp01(event.rms) : snapshot.rms,
    peak: event.peak != null ? clamp01(event.peak) : snapshot.peak,
    audioLevel,
    frames: event.frames != null ? Number(event.frames) || 0 : snapshot.frames,
    wakeKeyword: event.wakeKeyword ?? snapshot.wakeKeyword,
    wakeConfidence: event.wakeConfidence != null ? clamp01(event.wakeConfidence) : snapshot.wakeConfidence,
    transcript: event.transcript ?? snapshot.transcript,
    sttText: event.sttText ?? snapshot.sttText,
    reply: event.reply ?? snapshot.reply,
    status: event.status ?? snapshot.status,
    error: event.error ?? snapshot.error,
    waveform,
  };

  nextPartial.micOpen = inferMicOpen(nextPartial);
  nextPartial.canAcceptUserSpeech = event.canAcceptUserSpeech ?? (!nextPartial.assistantSpeaking && nextPartial.micOpen && nextPartial.phase !== 'thinking' && nextPartial.phase !== 'tool_call' && nextPartial.phase !== 'speaking');

  snapshot = nextPartial as VoiceTelemetrySnapshot;

  const storedEvent: VoiceTelemetryEvent = { ...event, at };
  events.unshift(storedEvent);
  while (events.length > 150) events.pop();

  notify();
  return snapshot;
}

export function getVoiceTelemetrySnapshot() {
  return snapshot;
}

export function subscribeVoiceTelemetry(listener: Listener) {
  listeners.add(listener);
  listener(snapshot);
  return () => listeners.delete(listener);
}

export function markAssistantSpeaking(active: boolean, status?: string) {
  publishVoiceTelemetry({
    phase: active ? 'speaking' : 'recovering',
    assistantSpeaking: active,
    micOpen: !active,
    canAcceptUserSpeech: !active,
    status: status ?? (active ? 'AGA speaking — mic paused' : 'speech complete — settling'),
  });
}

export function markMicOpen(open: boolean, status?: string) {
  publishVoiceTelemetry({
    micOpen: open,
    canAcceptUserSpeech: open && !snapshot.assistantSpeaking,
    status: status ?? (open ? 'mic open' : 'mic paused'),
  });
}

export function resetVoiceTelemetry() {
  events.length = 0;
  waveform.splice(0, waveform.length, ...Array.from({ length: 48 }, () => 0));
  snapshot = {
    ...snapshot,
    at: Date.now(),
    phase: 'wake_listening',
    provider: 'reset',
    micOpen: true,
    assistantSpeaking: false,
    commandWindowActive: false,
    canAcceptUserSpeech: true,
    rms: 0,
    peak: 0,
    audioLevel: 0,
    wakeKeyword: '',
    wakeConfidence: 0,
    transcript: '',
    sttText: '',
    reply: '',
    status: 'ready',
    error: '',
    events,
    waveform,
  };
  notify();
}
