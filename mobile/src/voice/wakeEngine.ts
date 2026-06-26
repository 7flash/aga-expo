import { Platform } from 'react-native';
import { NativeSpeechLoop } from './nativeSpeech';
import { PorcupineWakeEngine, isPorcupineWakeAvailable, type PorcupineDetection } from './porcupineWakeEngine';
import { BrowserDevWakeEngine } from './browserDevWakeEngine';
import { detectWake, normalizeSpeech } from '../aga/text';

export type WakeEngineEvent =
  | { type: 'wake'; label: 'aga' | string; text?: string; source: 'porcupine' | 'speech' | 'web_speech' }
  | { type: 'control'; command: 'stop' | 'pause' | 'resume'; source: 'porcupine' | 'speech' | 'web_speech' }
  | { type: 'transcript'; text: string; final: boolean; source: 'speech' | 'web_speech' }
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

function webPreviewAllowed() {
  const raw = String(env('EXPO_PUBLIC_AGA_ALLOW_WEB_SPEECH_PREVIEW') || '1').toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'no';
}

function createBrowserDevWake(callbacks: WakeEngineCallbacks, wakePhrase: string): WakeEngine {
  return new BrowserDevWakeEngine({
    onEvent: (event) => {
      if (event.type === 'transcript') callbacks.onEvent({ ...event, source: 'web_speech' });
      else if (event.type === 'control') callbacks.onEvent({ type: 'control', command: event.command, source: 'web_speech' });
      else callbacks.onEvent({ type: 'wake', label: 'aga', text: event.text, source: 'web_speech' });
    },
    onStatus: (status) => callbacks.onEvent({ type: 'status', status }),
    onError: (message) => callbacks.onEvent({ type: 'error', message }),
  }, wakePhrase);
}

export function createWakeEngine(callbacks: WakeEngineCallbacks, wakePhrase = env('EXPO_PUBLIC_AGA_WAKE_WORD') || 'aga'): WakeEngine {
  const requested = wakeEngineName();

  // Web preview cannot load the native Porcupine manager. Use browser speech only
  // for development visibility. Android/iOS appliance builds still use Porcupine.
  if ((requested === 'web_speech' || requested === 'browser') || (Platform.OS === 'web' && webPreviewAllowed() && (requested === 'porcupine' || requested === 'auto'))) {
    return createBrowserDevWake(callbacks, wakePhrase);
  }

  if (requested === 'porcupine' || requested === 'auto') {
    if (requested === 'auto' && !isPorcupineWakeAvailable() && Platform.OS === 'web' && webPreviewAllowed()) {
      return createBrowserDevWake(callbacks, wakePhrase);
    }
    return new PorcupineWakeEngine({
      onDetected: (detected) => callbacks.onEvent(labelToEvent(detected)),
      onStatus: (status) => callbacks.onEvent({ type: 'status', status }),
      onError: (message) => callbacks.onEvent({ type: 'error', message }),
    });
  }

  // Last-resort dev fallback. Android appliance builds should not use this path.
  const loop = new NativeSpeechLoop({
    onPartial: (text) => {
      const clean = normalizeSpeech(text);
      if (clean) callbacks.onEvent({ type: 'transcript', text: clean, final: false, source: 'speech' });
      if (detectWake(clean, wakePhrase).woke) callbacks.onEvent({ type: 'wake', label: 'aga', text: clean, source: 'speech' });
    },
    onFinal: (text) => {
      const clean = normalizeSpeech(text);
      if (clean) callbacks.onEvent({ type: 'transcript', text: clean, final: true, source: 'speech' });
      if (/\b(stop|quiet|cancel)\b/i.test(clean)) callbacks.onEvent({ type: 'control', command: 'stop', source: 'speech' });
      else if (/\b(pause|hold)\b/i.test(clean)) callbacks.onEvent({ type: 'control', command: 'pause', source: 'speech' });
      else if (detectWake(clean, wakePhrase).woke) callbacks.onEvent({ type: 'wake', label: 'aga', text: clean, source: 'speech' });
    },
    onStatus: (status) => callbacks.onEvent({ type: 'status', status: `speech fallback: ${status}` }),
    onError: (message) => callbacks.onEvent({ type: 'error', message: `speech fallback: ${message}` }),
  });
  return {
    start: () => loop.start({ watchdogEnabled: false } as any),
    stop: () => loop.stop(),
    getDiagnostics: () => ({ provider: 'speech-fallback', diagnostics: loop.getDiagnostics?.() }),
  };
}
