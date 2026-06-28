import {
  browserVoicePhaseLabel,
  browserVoiceShouldIgnoreWake,
  markWakeDetected,
} from './browserVoiceActivityState';
import { publishVoiceTelemetry } from './voiceTelemetryStore';

export type WakeDebugEvent =
  | { type: 'status'; provider?: string; message: string; at: number }
  | { type: 'audio'; provider?: string; rms: number; peak: number; frames: number; at: number }
  | { type: 'keyword'; provider?: string; keyword: string; index?: number; confidence?: number; raw?: unknown; at: number }
  | { type: 'transcript'; provider?: string; text: string; phase: 'post-wake' | 'stt' | 'live' | 'debug'; raw?: unknown; at: number }
  | { type: 'error'; provider?: string; message: string; raw?: unknown; at: number };

type Listener = (event: WakeDebugEvent) => void;

const listeners = new Set<Listener>();
const recent: WakeDebugEvent[] = [];

let bridgePromise: Promise<void> | null = null;
let lastAudio: Extract<WakeDebugEvent, { type: 'audio' }> | null = null;
let audioGateLoudSince = 0;
let audioGateLastWakeAt = 0;
let audioGateLastStatusAt = 0;

function now() {
  return Date.now();
}

function numEnv(name: string, fallback: number) {
  const value = Number((process as any)?.env?.[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function flagEnv(name: string, fallback = true) {
  const raw = String((process as any)?.env?.[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function dispatchBrowserEvent(name: string, detail: unknown) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {}
}

function bootBrowserBridge() {
  if (typeof window === 'undefined') return Promise.resolve();

  if (!bridgePromise) {
    bridgePromise = import('./browserWakeToTranscriptBridge')
      .then((mod) => {
        mod.ensureBrowserWakeToTranscriptBridge?.();
      })
      .catch((error) => {
        console.warn('[aga:wake-debug] failed to boot browser wake transcript bridge', error);
      });
  }

  return bridgePromise;
}

function telemetryPhaseFromBrowserState() {
  const label = browserVoicePhaseLabel();
  if (label === 'COMMAND WINDOW') return 'command_window' as const;
  if (label === 'THINKING') return 'thinking' as const;
  if (label === 'SPEAKING') return 'speaking' as const;
  return undefined;
}

function publishFromWakeEvent(event: WakeDebugEvent) {
  const phase = telemetryPhaseFromBrowserState();
  const provider = event.provider || 'wake-debug';

  if (event.type === 'audio') {
    publishVoiceTelemetry({
      at: event.at,
      phase: phase ?? 'hearing_audio',
      provider,
      wakeEngine: provider,
      rms: event.rms,
      peak: event.peak,
      frames: event.frames,
      micOpen: !browserVoiceShouldIgnoreWake(),
      assistantSpeaking: phase === 'speaking',
      commandWindowActive: phase === 'command_window',
      status: phase === 'speaking'
        ? 'AGA is speaking — mic paused'
        : phase === 'command_window'
          ? 'Command window active'
          : 'Mic live',
    });
    return;
  }

  if (event.type === 'keyword') {
    publishVoiceTelemetry({
      at: event.at,
      phase: 'wake_detected',
      provider,
      wakeEngine: provider,
      wakeKeyword: event.keyword,
      wakeConfidence: event.confidence ?? 0,
      commandWindowActive: true,
      status: `Wake detected: ${event.keyword}`,
      raw: event.raw,
    });
    return;
  }

  if (event.type === 'transcript') {
    publishVoiceTelemetry({
      at: event.at,
      phase: event.phase === 'live' ? 'live_session' : event.phase === 'stt' ? 'transcribing' : phase ?? 'capturing_user',
      provider,
      transcript: event.text,
      sttText: event.phase === 'stt' ? event.text : undefined,
      commandWindowActive: phase === 'command_window',
      status: event.phase === 'stt' ? 'Transcribed user speech' : 'Heard user speech',
      raw: event.raw,
    });
    return;
  }

  if (event.type === 'status') {
    publishVoiceTelemetry({
      at: event.at,
      phase: phase ?? 'wake_listening',
      provider,
      status: event.message,
    });
    return;
  }

  if (event.type === 'error') {
    publishVoiceTelemetry({
      at: event.at,
      phase: 'error',
      provider,
      error: event.message,
      status: event.message,
      raw: event.raw,
    });
  }
}

function autoWakeFromAudio(event: Extract<WakeDebugEvent, { type: 'audio' }>) {
  if (typeof window === 'undefined') return;
  if (!flagEnv('EXPO_PUBLIC_AGA_WEB_AUDIO_WAKE_FALLBACK', true)) return;

  const t = now();
  const threshold = numEnv('EXPO_PUBLIC_AGA_WEB_AUDIO_WAKE_RMS', 0.028);
  const peakThreshold = numEnv('EXPO_PUBLIC_AGA_WEB_AUDIO_WAKE_PEAK', 0.18);
  const holdMs = numEnv('EXPO_PUBLIC_AGA_WEB_AUDIO_WAKE_HOLD_MS', 420);
  const cooldownMs = numEnv('EXPO_PUBLIC_AGA_WEB_AUDIO_WAKE_COOLDOWN_MS', 6500);
  const loud = event.rms >= threshold || event.peak >= peakThreshold;

  if (!loud) {
    audioGateLoudSince = 0;
    return;
  }

  if (!audioGateLoudSince) audioGateLoudSince = t;

  if (browserVoiceShouldIgnoreWake()) {
    if (t - audioGateLastStatusAt > 1600) {
      audioGateLastStatusAt = t;
      push({
        type: 'status',
        provider: 'wake-debug-audio-gate',
        message: 'audio wake muted while AGA is listening/thinking/speaking',
        at: t,
      });
    }
    return;
  }

  if (t - audioGateLoudSince < holdMs) return;
  if (t - audioGateLastWakeAt < cooldownMs) return;

  audioGateLastWakeAt = t;
  audioGateLoudSince = 0;

  const confidence = Math.max(
    0.1,
    Math.min(1, Math.max(event.rms / Math.max(0.001, threshold), event.peak / Math.max(0.001, peakThreshold)) / 3),
  );

  markWakeDetected('browser audio gate');

  push({
    type: 'keyword',
    provider: 'wake-debug-audio-gate',
    keyword: 'aga',
    confidence,
    raw: {
      rms: event.rms,
      peak: event.peak,
      frames: event.frames,
      note: 'browser preview uses sustained audio wake until Sherpa KWS is confirmed in wake-lab',
    },
    at: t,
  });
}

function push(event: WakeDebugEvent) {
  recent.push(event);
  if (recent.length > 180) recent.shift();

  if (event.type === 'audio') {
    lastAudio = event;
    autoWakeFromAudio(event);
  }

  if (event.type === 'keyword') {
    bootBrowserBridge().then(() => {
      dispatchBrowserEvent('aga:wakeKeyword', event);
      setTimeout(() => dispatchBrowserEvent('aga:wakeKeyword', event), 120);
    });
  }

  if (event.type === 'transcript') {
    dispatchBrowserEvent('aga:wakeTranscript', event);
  }

  publishFromWakeEvent(event);
  dispatchBrowserEvent('aga:wakeDebug', event);

  for (const listener of Array.from(listeners)) {
    try {
      listener(event);
    } catch (error) {
      console.warn('[aga:wake-debug] listener failed', error);
    }
  }
}

export function emitWakeDebug(event: Omit<WakeDebugEvent, 'at'> & { at?: number }) {
  push({ ...event, at: event.at || now() } as WakeDebugEvent);
}

export function subscribeWakeDebug(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRecentWakeDebugEvents() {
  return recent.slice();
}

export function getLastWakeAudioEvent() {
  return lastAudio;
}

declare global {
  interface Window {
    __AGA_WAKE_DEBUG?: () => WakeDebugEvent[];
    __AGA_FORCE_AUDIO_WAKE?: () => void;
  }
}

if (typeof window !== 'undefined') {
  window.__AGA_WAKE_DEBUG = getRecentWakeDebugEvents;
  window.__AGA_FORCE_AUDIO_WAKE = () => {
    push({
      type: 'keyword',
      provider: 'manual',
      keyword: 'aga',
      confidence: 1,
      raw: { manual: true },
      at: now(),
    });
  };

  // Important: this module no longer injects a floating fixed-position UI.
  // Wake waveform/status is rendered by React through voiceTelemetryStore.
}
