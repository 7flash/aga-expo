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
  at: number;
  phase?: VoiceTelemetryPhase;
  platform?: 'web' | 'android' | 'ios' | 'unknown';
  wakeEngine?: string;
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

export type VoiceTelemetrySnapshot = Required<Pick<VoiceTelemetryEvent, 'at'>> & {
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
};

type Listener = (snapshot: VoiceTelemetrySnapshot) => void;

const listeners = new Set<Listener>();
const events: VoiceTelemetryEvent[] = [];

let snapshot: VoiceTelemetrySnapshot = {
  at: Date.now(),
  phase: 'wake_listening',
  platform: 'unknown',
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
  status: 'Waiting for voice',
  error: '',
  events: [],
};

function normalizeLevel(rms?: number, peak?: number, audioLevel?: number) {
  if (typeof audioLevel === 'number' && Number.isFinite(audioLevel)) return Math.max(0, Math.min(1, audioLevel));
  const r = typeof rms === 'number' && Number.isFinite(rms) ? rms : 0;
  const p = typeof peak === 'number' && Number.isFinite(peak) ? peak : 0;
  return Math.max(0, Math.min(1, Math.max(r * 18, p * 4)));
}

function inferPlatform(): VoiceTelemetrySnapshot['platform'] {
  if (typeof navigator !== 'undefined') return 'web';
  return 'unknown';
}

function nextFromEvent(event: VoiceTelemetryEvent): VoiceTelemetrySnapshot {
  const phase = event.phase ?? snapshot.phase;
  const rms = typeof event.rms === 'number' ? event.rms : snapshot.rms;
  const peak = typeof event.peak === 'number' ? event.peak : snapshot.peak;
  const assistantSpeaking = event.assistantSpeaking ?? phase === 'speaking' ?? snapshot.assistantSpeaking;
  const commandWindowActive = event.commandWindowActive ?? phase === 'command_window' ?? snapshot.commandWindowActive;
  const micOpen = event.micOpen ?? (!assistantSpeaking && !['thinking', 'tool_call', 'transcribing'].includes(phase));
  const canAcceptUserSpeech = event.canAcceptUserSpeech ?? (micOpen && !assistantSpeaking && !['thinking', 'tool_call', 'transcribing'].includes(phase));

  return {
    ...snapshot,
    ...event,
    at: event.at,
    phase,
    platform: event.platform ?? snapshot.platform ?? inferPlatform(),
    wakeEngine: event.wakeEngine ?? snapshot.wakeEngine,
    provider: event.provider ?? snapshot.provider,
    micOpen,
    assistantSpeaking,
    commandWindowActive,
    canAcceptUserSpeech,
    rms,
    peak,
    audioLevel: normalizeLevel(rms, peak, event.audioLevel),
    frames: typeof event.frames === 'number' ? event.frames : snapshot.frames,
    wakeKeyword: event.wakeKeyword ?? snapshot.wakeKeyword,
    wakeConfidence: typeof event.wakeConfidence === 'number' ? event.wakeConfidence : snapshot.wakeConfidence,
    transcript: event.transcript ?? snapshot.transcript,
    sttText: event.sttText ?? snapshot.sttText,
    reply: event.reply ?? snapshot.reply,
    status: event.status ?? snapshot.status,
    error: event.error ?? (phase === 'error' ? snapshot.error : ''),
    events: events.slice(-80),
  };
}

export function publishVoiceTelemetry(event: Omit<VoiceTelemetryEvent, 'at'> & { at?: number }) {
  const full: VoiceTelemetryEvent = { ...event, at: event.at ?? Date.now() };
  events.push(full);
  if (events.length > 240) events.splice(0, events.length - 240);
  snapshot = nextFromEvent(full);
  snapshot.events = events.slice(-80);

  for (const listener of Array.from(listeners)) {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn('[aga:telemetry] listener failed', error);
    }
  }

  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('aga:voiceTelemetry', { detail: snapshot }));
    } catch {}
  }
}

export function getVoiceTelemetrySnapshot() {
  return snapshot;
}

export function subscribeVoiceTelemetry(listener: Listener) {
  listeners.add(listener);
  try { listener(snapshot); } catch {}
  return () => listeners.delete(listener);
}

export function resetVoiceTelemetry(status = 'Waiting for voice') {
  events.splice(0, events.length);
  snapshot = {
    ...snapshot,
    at: Date.now(),
    phase: 'wake_listening',
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
    status,
    error: '',
    events: [],
  };
  for (const listener of Array.from(listeners)) listener(snapshot);
}

declare global {
  interface Window {
    __AGA_VOICE_TELEMETRY?: () => VoiceTelemetrySnapshot;
  }
}

if (typeof window !== 'undefined') {
  window.__AGA_VOICE_TELEMETRY = getVoiceTelemetrySnapshot;
}
