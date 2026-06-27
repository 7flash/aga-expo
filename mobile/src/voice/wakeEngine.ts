import { Platform } from 'react-native';
import { AGA_CONFIG } from '../config/agaConfig';
import { SherpaWasmKeywordEngine } from './sherpaWasmKeywordEngine';

export type WakeKeywordProvider =
  | 'sherpa-wasm'
  | 'sherpa-native'
  | 'porcupine'
  | 'dev'
  | 'unavailable';

export type WakeEngineEvent = {
  type: 'keyword' | 'status' | 'error';
  provider: WakeKeywordProvider | string;
  keyword?: string;
  index?: number;
  confidence?: number;
  message?: string;
  raw?: unknown;
};

export type KeywordEngineConfig = {
  keywords?: string[];
  wakeKeywords?: string[];
  allowDevFallback?: boolean;
};

export interface KeywordEngine {
  start(config?: KeywordEngineConfig): Promise<void>;
  stop(): Promise<void>;
  subscribe(listener: (event: WakeEngineEvent) => void): () => void;
}

export type WakeEngine = KeywordEngine;

function wakeKeywords() {
  return AGA_CONFIG.wake.sherpaKeywords.length ? [...AGA_CONFIG.wake.sherpaKeywords] : ['aga', 'stop', 'pause'];
}

class UnavailableWakeEngine implements WakeEngine {
  private listeners = new Set<(event: WakeEngineEvent) => void>();
  constructor(private readonly message: string, private readonly provider: WakeKeywordProvider = 'unavailable') {}

  async start() {
    const event: WakeEngineEvent = {
      type: 'error',
      provider: this.provider,
      message: this.message,
    };
    this.emit(event);
    throw new Error(this.message);
  }

  async stop() {}

  subscribe(listener: (event: WakeEngineEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: WakeEngineEvent) {
    for (const listener of Array.from(this.listeners)) listener(event);
  }
}

class DevKeywordEngine implements WakeEngine {
  private listeners = new Set<(event: WakeEngineEvent) => void>();
  private keywords = wakeKeywords();

  async start(config: KeywordEngineConfig = {}) {
    this.keywords = config.keywords || config.wakeKeywords || this.keywords;
    const root: any = globalThis as any;

    root.__AGA_WAKE = () => this.fire('aga');
    root.__AGA_STOP = () => this.fire('stop');
    root.__AGA_PAUSE = () => this.fire('pause');
    root.__AGA_KEYWORD = (word: string) => this.fire(String(word || ''));

    this.emit({
      type: 'status',
      provider: 'dev',
      message: 'Dev keyword injector ready: __AGA_WAKE(), __AGA_STOP(), __AGA_PAUSE(), __AGA_KEYWORD("aga").',
    });
  }

  async stop() {}

  subscribe(listener: (event: WakeEngineEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private fire(keyword: string) {
    const clean = keyword.toLowerCase().trim();
    const index = this.keywords.findIndex((k) => clean.includes(k.toLowerCase()));
    this.emit({
      type: 'keyword',
      provider: 'dev',
      keyword: clean,
      index: index >= 0 ? index : undefined,
      confidence: 1,
      raw: { dev: true },
    });
  }

  private emit(event: WakeEngineEvent) {
    for (const listener of Array.from(this.listeners)) listener(event);
  }
}

class SherpaNativePlaceholderEngine implements WakeEngine {
  private listeners = new Set<(event: WakeEngineEvent) => void>();

  async start(config: KeywordEngineConfig = {}) {
    try {
      const mod = await import('react-native-sherpa-onnx' as any);
      const factory =
        (mod as any).createKeywordSpotter ||
        (mod as any).SherpaOnnxKws ||
        (mod as any).KeywordSpotter ||
        (mod as any).default;

      if (!factory) {
        throw new Error(`react-native-sherpa-onnx loaded but no known keyword spotter export found. Exports: ${Object.keys(mod as any).join(', ')}`);
      }

      this.emit({
        type: 'status',
        provider: 'sherpa-native',
        message: 'Native Sherpa module detected. Wire concrete Android KWS adapter here if not already provided by your installed package.',
        raw: { exports: Object.keys(mod as any), config },
      });

      throw new Error('Native Sherpa adapter exists but is not fully mapped in this web-first patch.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit({ type: 'error', provider: 'sherpa-native', message });
      throw error;
    }
  }

  async stop() {}

  subscribe(listener: (event: WakeEngineEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: WakeEngineEvent) {
    for (const listener of Array.from(this.listeners)) listener(event);
  }
}

class PorcupinePlaceholderEngine implements WakeEngine {
  private listeners = new Set<(event: WakeEngineEvent) => void>();

  async start() {
    try {
      const mod = await import('@picovoice/porcupine-react-native' as any);
      this.emit({
        type: 'status',
        provider: 'porcupine',
        message: 'Porcupine module detected. This build prefers Sherpa; Porcupine fallback adapter is not active in web.',
        raw: { exports: Object.keys(mod as any) },
      });
      throw new Error('Porcupine fallback is disabled for browser Path A. Use EXPO_PUBLIC_AGA_BROWSER_KEYWORD_ENGINE=sherpa_wasm.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit({ type: 'error', provider: 'porcupine', message });
      throw error;
    }
  }

  async stop() {}

  subscribe(listener: (event: WakeEngineEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: WakeEngineEvent) {
    for (const listener of Array.from(this.listeners)) listener(event);
  }
}

function createWebWakeEngine() {
  const browserEngine = AGA_CONFIG.wake.browserEngine;
  const allowDev = AGA_CONFIG.wake.allowDevKeywordInjector;

  if (browserEngine === 'sherpa_wasm' || browserEngine === 'sherpa' || browserEngine === 'sherpa_native') {
    return new SherpaWasmKeywordEngine();
  }

  if (browserEngine === 'dev') {
    if (!allowDev) {
      return new UnavailableWakeEngine('Dev keyword injector requested but EXPO_PUBLIC_AGA_ALLOW_DEV_KEYWORD_INJECTOR=1 is not set.', 'dev');
    }
    return new DevKeywordEngine();
  }

  if (browserEngine === 'disabled') {
    return new UnavailableWakeEngine('Wake engine disabled by config.', 'unavailable');
  }

  if (browserEngine === 'porcupine') return new PorcupinePlaceholderEngine();

  return new UnavailableWakeEngine(`Unsupported browser keyword engine: ${browserEngine}. Use sherpa_wasm.`, 'unavailable');
}

function createNativeWakeEngine() {
  const nativeEngine = AGA_CONFIG.wake.engine;
  const allowDev = AGA_CONFIG.wake.allowDevKeywordInjector;

  if (nativeEngine === 'sherpa' || nativeEngine === 'sherpa_native' || nativeEngine === 'sherpa_wasm') {
    return new SherpaNativePlaceholderEngine();
  }

  if (nativeEngine === 'porcupine') return new PorcupinePlaceholderEngine();
  if (nativeEngine === 'dev' && allowDev) return new DevKeywordEngine();
  if (nativeEngine === 'disabled') return new UnavailableWakeEngine('Wake engine disabled by config.', 'unavailable');

  return new UnavailableWakeEngine(`Unsupported native keyword engine: ${nativeEngine}. Use sherpa or porcupine.`, 'unavailable');
}

export function createWakeEngine(): WakeEngine {
  if (Platform.OS === 'web') return createWebWakeEngine();
  return createNativeWakeEngine();
}

export function defaultWakeKeywords() {
  return wakeKeywords();
}