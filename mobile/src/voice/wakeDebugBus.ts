import { publishVoiceTelemetry } from './voiceTelemetryStore';
import { runExclusiveVoiceTurn } from './exclusiveVoiceTurn';

export type WakeDebugEvent =
  | { type: 'status'; provider?: string; message: string; at?: number; raw?: unknown }
  | { type: 'audio'; provider?: string; rms: number; peak: number; frames: number; at?: number; raw?: unknown }
  | { type: 'keyword'; provider?: string; keyword: string; index?: number; confidence?: number; raw?: unknown; at?: number }
  | { type: 'transcript'; provider?: string; text: string; phase: 'post-wake' | 'stt' | 'live' | 'debug'; raw?: unknown; at?: number }
  | { type: 'error'; provider?: string; message: string; raw?: unknown; at?: number };

type Listener = (event: WakeDebugEvent) => void;

const listeners = new Set<Listener>();
const recent: WakeDebugEvent[] = [];
let lastFinalTranscript = '';
let lastFinalAt = 0;

function now() { return Date.now(); }

function normalize(text: unknown) { return String(text ?? '').replace(/\s+/g, ' ').trim(); }

export function emitWakeDebug(input: Omit<WakeDebugEvent, 'at'> & { at?: number }) {
  const event = { ...input, at: input.at ?? now() } as WakeDebugEvent;
  recent.unshift(event);
  while (recent.length > 200) recent.pop();

  if (event.type === 'audio') {
    publishVoiceTelemetry({
      at: event.at,
      phase: 'hearing_audio',
      provider: event.provider || 'wake',
      wakeEngine: event.provider || 'unknown',
      rms: event.rms,
      peak: event.peak,
      frames: event.frames,
      audioLevel: Math.max(0, Math.min(1, Math.max(event.rms * 12, event.peak * 4))),
      status: 'mic audio',
    });
  } else if (event.type === 'keyword') {
    const fallback = !!(event.raw as any)?.fallback;
    publishVoiceTelemetry({
      at: event.at,
      phase: 'wake_detected',
      provider: event.provider || 'wake',
      wakeEngine: fallback ? 'volume' : event.provider || 'unknown',
      wakeKeyword: event.keyword,
      wakeConfidence: event.confidence ?? (fallback ? 0.25 : 1),
      commandWindowActive: true,
      micOpen: true,
      canAcceptUserSpeech: true,
      status: fallback
        ? `fallback wake: ${event.keyword} — not real keyword spotting`
        : `wake keyword: ${event.keyword}`,
      raw: event.raw,
    });
  } else if (event.type === 'transcript') {
    publishVoiceTelemetry({
      at: event.at,
      phase: event.phase === 'stt' || event.phase === 'post-wake' ? 'transcribing' : 'live_session',
      provider: event.provider || 'transcript',
      transcript: event.text,
      sttText: event.phase === 'stt' || event.phase === 'post-wake' ? event.text : undefined,
      status: `transcript: ${event.text}`,
      raw: event.raw,
    });
  } else if (event.type === 'error') {
    publishVoiceTelemetry({ at: event.at, phase: 'error', provider: event.provider || 'wake', error: event.message, status: event.message, raw: event.raw });
  } else if (event.type === 'status') {
    publishVoiceTelemetry({ at: event.at, provider: event.provider || 'wake', status: event.message, raw: event.raw });
  }

  for (const listener of Array.from(listeners)) {
    try { listener(event); } catch {}
  }

  return event;
}

export function subscribeWakeDebug(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRecentWakeDebugEvents() {
  return recent.slice();
}

/**
 * Final transcript entrypoint for browser wake/STT. It intentionally runs the same
 * exclusive executor used by the labs and main screen. Do not call GPT/TTS/tools
 * directly from wake bridges anymore.
 */
export async function submitWakeFinalTranscript(textInput: unknown, raw?: unknown) {
  const text = normalize(textInput);
  if (!text) return false;
  const at = now();
  if (text === lastFinalTranscript && at - lastFinalAt < 1500) {
    emitWakeDebug({ type: 'status', provider: 'post-wake', message: `deduped final transcript: ${text}`, raw });
    return false;
  }
  lastFinalTranscript = text;
  lastFinalAt = at;
  emitWakeDebug({ type: 'transcript', provider: 'post-wake', text, phase: 'post-wake', raw });
  await runExclusiveVoiceTurn(text, { source: 'post-wake', forceRoute: 'auto' });
  return true;
}

/**
 * Legacy compatibility for old code that expected a browser UI starter.
 * It no longer creates a floating DOM overlay. Waveform is rendered by React
 * from voiceTelemetryStore.
 */
export function startBrowserWakeUi() {
  emitWakeDebug({ type: 'status', provider: 'wake-ui', message: 'wake UI overlay disabled; telemetry is integrated into main cockpit' });
  return () => {};
}
