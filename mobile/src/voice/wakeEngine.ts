import { Platform } from 'react-native';
import { PorcupineWakeEngine, isPorcupineWakeAvailable, type PorcupineDetection } from './porcupineWakeEngine';
import { PorcupineWebWakeEngine } from './porcupineWebWakeEngine';
import { DevKeywordInjectorWakeEngine } from './devKeywordInjectorWakeEngine';

export type WakeKeywordSource = 'porcupine' | 'porcupine_web' | 'dev_keyword';

export type WakeEngineEvent =
  | { type: 'wake'; label: 'aga' | string; source: WakeKeywordSource }
  | { type: 'control'; command: 'stop' | 'pause' | 'resume'; source: WakeKeywordSource }
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

function webWakeEngineName() {
  return String(env('EXPO_PUBLIC_AGA_WEB_WAKE_ENGINE') || '').toLowerCase();
}

function labelToEvent(event: PorcupineDetection, source: WakeKeywordSource): WakeEngineEvent {
  const label = String(event.label || '').toLowerCase();
  if (event.index === 1 || label === 'stop') return { type: 'control', command: 'stop', source };
  if (event.index === 2 || label === 'pause') return { type: 'control', command: 'pause', source };
  return { type: 'wake', label: label || 'aga', source };
}

function createDevEngine(callbacks: WakeEngineCallbacks, reason: string): WakeEngine {
  return new DevKeywordInjectorWakeEngine({
    onWake: (label) => callbacks.onEvent({ type: 'wake', label, source: 'dev_keyword' }),
    onControl: (command) => callbacks.onEvent({ type: 'control', command, source: 'dev_keyword' }),
    onStatus: (status) => callbacks.onEvent({ type: 'status', status }),
    onError: (message) => callbacks.onEvent({ type: 'error', message }),
  }, reason);
}

/**
 * Wake engine factory.
 *
 * Important contract:
 * - Android/iOS appliance hot mic is Porcupine keyword spotting only.
 * - Browser preview does not use SpeechRecognition by default.
 * - Browser preview uses Porcupine Web/WASM when configured, or an explicit dev
 *   keyword injector when EXPO_PUBLIC_AGA_WEB_WAKE_ENGINE=dev.
 * - Full utterances, menu choices, numbers, and language names are handled only
 *   by the post-wake command layer or live Gemini/OpenAI session.
 */
export function createWakeEngine(callbacks: WakeEngineCallbacks): WakeEngine {
  const requested = wakeEngineName();
  const requestedWeb = webWakeEngineName();

  if (requested === 'dev' || requested === 'keyword_dev' || requestedWeb === 'dev') {
    return createDevEngine(callbacks, 'explicit dev keyword injector');
  }

  if (requested === 'speech' || requested === 'web_speech' || requestedWeb === 'speech' || requestedWeb === 'web_speech') {
    return createDevEngine(callbacks, 'speech hot-mic disabled; use dev keyword injector or Porcupine Web');
  }

  if (Platform.OS === 'web') {
    if (requestedWeb === 'porcupine' || requestedWeb === 'porcupine_web' || requested === 'porcupine' || requested === 'auto') {
      return new PorcupineWebWakeEngine({
        onDetected: (detected) => callbacks.onEvent(labelToEvent(detected, 'porcupine_web')),
        onStatus: (status) => callbacks.onEvent({ type: 'status', status }),
        onError: (message) => callbacks.onEvent({ type: 'error', message }),
      });
    }
    return createDevEngine(callbacks, 'web wake engine not configured');
  }

  if (requested === 'porcupine' || requested === 'auto') {
    if (requested === 'auto' && !isPorcupineWakeAvailable()) {
      return createDevEngine(callbacks, 'Porcupine native unavailable in auto mode');
    }
    return new PorcupineWakeEngine({
      onDetected: (detected) => callbacks.onEvent(labelToEvent(detected, 'porcupine')),
      onStatus: (status) => callbacks.onEvent({ type: 'status', status }),
      onError: (message) => callbacks.onEvent({ type: 'error', message }),
    });
  }

  return createDevEngine(callbacks, `unknown wake engine "${requested}"`);
}
