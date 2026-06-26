import { Platform } from 'react-native';
import { PorcupineWakeEngine, isPorcupineWakeAvailable, type PorcupineDetection } from './porcupineWakeEngine';
import { PorcupineWebWakeEngine } from './porcupineWebWakeEngine';
import { DevKeywordInjectorWakeEngine } from './devKeywordInjectorWakeEngine';
import { createSherpaKeywordEngine } from './sherpaKeywordEngine';
import { wakeKeywords } from './sherpaKeywordPhrases';
import { shouldAllowDevKeywordFallback } from './sherpaModelManifest';
import type { KeywordEngine, KeywordEvent } from './keywordEngine';

export type WakeKeywordSource = 'sherpa_native' | 'sherpa_wasm' | 'porcupine' | 'porcupine_web' | 'dev_keyword';

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
  return String(env('EXPO_PUBLIC_AGA_KEYWORD_ENGINE') || env('EXPO_PUBLIC_AGA_WAKE_ENGINE') || 'sherpa').toLowerCase();
}

function webWakeEngineName() {
  return String(env('EXPO_PUBLIC_AGA_BROWSER_KEYWORD_ENGINE') || env('EXPO_PUBLIC_AGA_WEB_WAKE_ENGINE') || '').toLowerCase();
}

function porcupineToEvent(event: PorcupineDetection, source: WakeKeywordSource): WakeEngineEvent {
  const label = String(event.label || '').toLowerCase();
  if (event.index === 1 || label === 'stop') return { type: 'control', command: 'stop', source };
  if (event.index === 2 || label === 'pause') return { type: 'control', command: 'pause', source };
  return { type: 'wake', label: label || 'aga', source };
}

function sherpaToEvent(event: KeywordEvent): WakeEngineEvent {
  const source = event.provider as WakeKeywordSource;
  if (event.intent === 'control.stop') return { type: 'control', command: 'stop', source };
  if (event.intent === 'control.pause') return { type: 'control', command: 'pause', source };
  if (event.intent === 'control.resume') return { type: 'control', command: 'resume', source };
  return { type: 'wake', label: event.value || event.phrase || 'aga', source };
}

function createDevEngine(callbacks: WakeEngineCallbacks, reason: string): WakeEngine {
  return new DevKeywordInjectorWakeEngine({
    onWake: (label) => callbacks.onEvent({ type: 'wake', label, source: 'dev_keyword' }),
    onControl: (command) => callbacks.onEvent({ type: 'control', command, source: 'dev_keyword' }),
    onStatus: (status) => callbacks.onEvent({ type: 'status', status }),
    onError: (message) => callbacks.onEvent({ type: 'error', message }),
  }, reason);
}

class ResilientWakeEngine implements WakeEngine {
  private primary: WakeEngine;
  private fallbackFactory: () => WakeEngine | null;
  private active: WakeEngine | null = null;
  private fallbackReason: string | null = null;

  constructor(primary: WakeEngine, fallbackFactory: () => WakeEngine | null) {
    this.primary = primary;
    this.fallbackFactory = fallbackFactory;
  }

  async start() {
    try {
      this.active = this.primary;
      await Promise.resolve(this.primary.start());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'primary wake engine failed');
      await Promise.resolve(this.primary.stop?.()).catch(() => undefined);
      const fallback = this.fallbackFactory();
      if (!fallback) throw error;
      this.fallbackReason = message;
      this.active = fallback;
      await Promise.resolve(fallback.start());
    }
  }

  async stop() {
    const active = this.active;
    this.active = null;
    await Promise.resolve(active?.stop?.()).catch(() => undefined);
  }

  getDiagnostics() {
    return {
      provider: this.fallbackReason ? 'dev_keyword' : 'sherpa_wasm',
      fallbackReason: this.fallbackReason,
      active: this.active?.getDiagnostics?.(),
      primary: this.primary.getDiagnostics?.(),
    };
  }
}

class SherpaWakeEngine implements WakeEngine {
  private engine: KeywordEngine;
  private callbacks: WakeEngineCallbacks;
  private provider: 'sherpa_native' | 'sherpa_wasm' | 'dev_keyword';

  constructor(callbacks: WakeEngineCallbacks, provider?: 'sherpa_native' | 'sherpa_wasm' | 'dev_keyword') {
    this.callbacks = callbacks;
    this.provider = provider || (Platform.OS === 'web' ? 'sherpa_wasm' : 'sherpa_native');
    this.engine = createSherpaKeywordEngine({
      onKeyword: (event) => this.callbacks.onEvent(sherpaToEvent(event)),
      onStatus: (status) => this.callbacks.onEvent({ type: 'status', status }),
      onError: (message) => this.callbacks.onEvent({ type: 'error', message }),
      onNoMatch: (reason) => this.callbacks.onEvent({ type: 'status', status: `sherpa wake no-match: ${reason}` }),
    }, this.provider);
  }

  getDiagnostics() {
    return { provider: this.provider, diagnostics: this.engine.getDiagnostics?.() };
  }

  start() {
    return this.engine.start({ mode: 'wake', provider: this.provider, keywords: wakeKeywords(), timeoutMs: 0, allowTextFallback: false });
  }

  stop() {
    return this.engine.stop('wake_stop');
  }
}

/**
 * Wake engine factory.
 *
 * Product contract:
 * - No Android SpeechRecognizer hot-mic path.
 * - Sherpa native is the preferred Android keyword engine.
 * - Sherpa WASM is the preferred browser preview keyword engine.
 * - Porcupine remains a fallback for fixed aga/stop/pause keyword files.
 * - Dev injection is explicit fallback only.
 */
export function createWakeEngine(callbacks: WakeEngineCallbacks): WakeEngine {
  const requested = wakeEngineName();
  const requestedWeb = webWakeEngineName();

  if (requested === 'dev' || requested === 'keyword_dev' || requestedWeb === 'dev') {
    return createDevEngine(callbacks, 'explicit dev keyword injector');
  }

  if (requested === 'speech' || requested === 'web_speech' || requestedWeb === 'speech' || requestedWeb === 'web_speech') {
    return createDevEngine(callbacks, 'speech hot-mic disabled; use Sherpa, Porcupine, or explicit dev injection');
  }

  if (Platform.OS === 'web') {
    if (requestedWeb === 'sherpa' || requestedWeb === 'sherpa_wasm' || requested === 'sherpa' || requested === 'auto') {
      const primary = new SherpaWakeEngine(callbacks, 'sherpa_wasm');
      return new ResilientWakeEngine(primary, () => {
        if (!shouldAllowDevKeywordFallback()) return null;
        return createDevEngine(callbacks, 'Sherpa WASM unavailable; explicit dev keyword fallback enabled');
      });
    }
    if (requestedWeb === 'porcupine' || requestedWeb === 'porcupine_web' || requested === 'porcupine') {
      return new PorcupineWebWakeEngine({
        onDetected: (detected) => callbacks.onEvent(porcupineToEvent(detected, 'porcupine_web')),
        onStatus: (status) => callbacks.onEvent({ type: 'status', status }),
        onError: (message) => callbacks.onEvent({ type: 'error', message }),
      });
    }
    return createDevEngine(callbacks, 'web keyword engine not configured');
  }

  if (requested === 'sherpa' || requested === 'sherpa_native' || requested === 'auto') {
    return new SherpaWakeEngine(callbacks, 'sherpa_native');
  }

  if (requested === 'porcupine') {
    if (!isPorcupineWakeAvailable()) return createDevEngine(callbacks, 'Porcupine native unavailable');
    return new PorcupineWakeEngine({
      onDetected: (detected) => callbacks.onEvent(porcupineToEvent(detected, 'porcupine')),
      onStatus: (status) => callbacks.onEvent({ type: 'status', status }),
      onError: (message) => callbacks.onEvent({ type: 'error', message }),
    });
  }

  return createDevEngine(callbacks, `unknown wake engine "${requested}"`);
}
