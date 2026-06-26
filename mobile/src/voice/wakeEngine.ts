import { NativeSpeechLoop } from './nativeSpeech';
import { PorcupineWakeEngine, type PorcupineDetection } from './porcupineWakeEngine';
import { detectWake, normalizeSpeech } from '../aga/text';

export type WakeEngineEvent =
  | { type: 'wake'; label: 'aga' | string; text?: string; source: 'porcupine' | 'speech' }
  | { type: 'control'; command: 'stop' | 'pause' | 'resume'; source: 'porcupine' | 'speech' }
  | { type: 'status'; status: string }
  | { type: 'error'; message: string };

export type WakeEngine = {
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
  getDiagnostics?(): unknown;
};

export type WakeEngineCallbacks = {
  onEvent: (event: WakeEngineEvent) => void;
};

function env(name: string) {
  return process.env?.[name] ?? '';
}

function wakeEngineName() {
  return String(env('EXPO_PUBLIC_AGA_WAKE_ENGINE') || 'porcupine').toLowerCase();
}

function labelToEvent(event: PorcupineDetection): WakeEngineEvent {
  const label = String(event.label || '').toLowerCase();
  if (event.index === 1 || label === 'stop') return { type: 'control', command: 'stop', source: 'porcupine' };
  if (event.index === 2 || label === 'pause') return { type: 'control', command: 'pause', source: 'porcupine' };
  return { type: 'wake', label: label || 'aga', source: 'porcupine' };
}

export function createWakeEngine(callbacks: WakeEngineCallbacks, wakePhrase = env('EXPO_PUBLIC_AGA_WAKE_WORD') || 'aga'): WakeEngine {
  if (wakeEngineName() === 'porcupine') {
    return new PorcupineWakeEngine({
      onDetected: (detected) => callbacks.onEvent(labelToEvent(detected)),
      onStatus: (status) => callbacks.onEvent({ type: 'status', status }),
      onError: (message) => callbacks.onEvent({ type: 'error', message }),
    });
  }

  // Dev-only fallback. The appliance path should never depend on Android SpeechRecognizer.
  const loop = new NativeSpeechLoop({
    onFinal: (text) => {
      const clean = normalizeSpeech(text);
      if (/\b(stop|quiet|cancel)\b/i.test(clean)) callbacks.onEvent({ type: 'control', command: 'stop', source: 'speech' });
      else if (/\b(pause|hold)\b/i.test(clean)) callbacks.onEvent({ type: 'control', command: 'pause', source: 'speech' });
      else if (detectWake(clean, wakePhrase).woke) callbacks.onEvent({ type: 'wake', label: 'aga', text: clean, source: 'speech' });
    },
    onPartial: (text) => {
      const clean = normalizeSpeech(text);
      if (detectWake(clean, wakePhrase).woke) callbacks.onEvent({ type: 'wake', label: 'aga', text: clean, source: 'speech' });
    },
    onStatus: (status) => callbacks.onEvent({ type: 'status', status: `speech fallback: ${status}` }),
    onError: (message) => callbacks.onEvent({ type: 'error', message: `speech fallback: ${message}` }),
  });
  return {
    start: () => loop.start({ watchdogEnabled: false }),
    stop: () => loop.stop(),
    getDiagnostics: () => ({ provider: 'speech-fallback', diagnostics: loop.getDiagnostics?.() }),
  };
}
