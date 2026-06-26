import { Platform } from 'react-native';
import {
  flattenKeywordPhrases,
  matchKeywordText,
  type KeywordEngine,
  type KeywordEngineCallbacks,
  type KeywordEngineConfig,
  type KeywordEngineProvider,
  type KeywordEvent,
  type KeywordPhrase,
} from './keywordEngine';

function env(name: string) {
  return process.env?.[name] ?? '';
}

async function optionalImport(specifier: string): Promise<any | null> {
  try {
    return await (Function('s', 'return import(s)') as any)(specifier);
  } catch {
    return null;
  }
}

function root(): any {
  return globalThis as any;
}

function providerForPlatform(): KeywordEngineProvider {
  return Platform.OS === 'web' ? 'sherpa_wasm' : 'sherpa_native';
}

function toEvent(match: { keyword: KeywordPhrase; phrase: string; confidence?: number }, provider: KeywordEngineProvider, config: KeywordEngineConfig): KeywordEvent {
  return {
    id: match.keyword.id,
    intent: match.keyword.intent,
    phrase: match.phrase,
    value: match.keyword.value,
    confidence: match.confidence,
    provider,
    mode: config.mode,
    metadata: match.keyword.metadata,
  };
}

function buildKeywordText(keywords: KeywordPhrase[]) {
  // sherpa-onnx KWS accepts keyword/token lists depending on model packaging.
  // Keep a plain phrase representation here; native/WASM adapters can tokenize
  // internally when their concrete wrapper requires it.
  return flattenKeywordPhrases(keywords)
    .map(({ keyword, phrase }) => `${phrase} /${keyword.boost ?? 1.0}/ #${keyword.threshold ?? 0.5}`)
    .join('\n');
}

export class SherpaKeywordEngine implements KeywordEngine {
  private callbacks: KeywordEngineCallbacks;
  private config: KeywordEngineConfig | null = null;
  private provider: KeywordEngineProvider;
  private nativeInstance: any | null = null;
  private running = false;
  private detections = 0;
  private lastError: string | null = null;
  private noMatchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(callbacks: KeywordEngineCallbacks, provider: KeywordEngineProvider = providerForPlatform()) {
    this.callbacks = callbacks;
    this.provider = provider;
  }

  getDiagnostics() {
    return {
      provider: this.provider,
      running: this.running,
      mode: this.config?.mode,
      keywordCount: this.config?.keywords.length || 0,
      phraseCount: this.config ? flattenKeywordPhrases(this.config.keywords).length : 0,
      detections: this.detections,
      lastError: this.lastError,
      modelDir: env('EXPO_PUBLIC_AGA_SHERPA_MODEL_DIR') || env('EXPO_PUBLIC_AGA_SHERPA_WASM_MODEL_URL') || '(not configured)',
    };
  }

  async start(config: KeywordEngineConfig) {
    if (this.running) await this.stop('restart');
    this.config = config;
    this.running = true;
    this.detections = 0;

    const timeoutMs = config.timeoutMs || Number(env('EXPO_PUBLIC_AGA_POST_WAKE_COMMAND_WINDOW_MS') || 8000);
    if (config.mode !== 'wake' && timeoutMs > 0) {
      this.noMatchTimer = setTimeout(() => this.callbacks.onNoMatch?.('timeout'), timeoutMs);
    }

    if (this.provider === 'sherpa_wasm') return this.startWasm(config);
    return this.startNative(config);
  }

  async stop(reason = 'stop') {
    this.running = false;
    if (this.noMatchTimer) clearTimeout(this.noMatchTimer);
    this.noMatchTimer = null;
    try { await this.nativeInstance?.stop?.(); } catch { /* ignore */ }
    try { await this.nativeInstance?.release?.(); } catch { /* ignore */ }
    try { await this.nativeInstance?.destroy?.(); } catch { /* ignore */ }
    this.nativeInstance = null;
    this.callbacks.onStatus?.(`${this.provider} keyword engine stopped: ${reason}`);
  }

  async setKeywords(keywords: KeywordPhrase[]) {
    if (!this.config) return;
    this.config = { ...this.config, keywords };
    if (this.nativeInstance?.setKeywords) {
      await this.nativeInstance.setKeywords(this.materializeKeywords(keywords));
    }
  }

  private materializeKeywords(keywords: KeywordPhrase[]) {
    return {
      phrases: flattenKeywordPhrases(keywords).map(({ phrase }) => phrase),
      entries: keywords,
      keywordText: buildKeywordText(keywords),
    };
  }

  private acceptText(text: string) {
    if (!this.running || !this.config) return;
    const clean = String(text || '').trim();
    if (!clean) return;
    const match = matchKeywordText(clean, this.config.keywords);
    if (match) {
      this.detections += 1;
      if (this.noMatchTimer) clearTimeout(this.noMatchTimer);
      this.noMatchTimer = null;
      this.callbacks.onKeyword(toEvent(match, this.provider, this.config));
      return;
    }
    if (this.config.allowTextFallback) {
      this.callbacks.onText?.(clean, this.provider);
    }
  }

  private async startNative(config: KeywordEngineConfig) {
    const mod = await optionalImport('react-native-sherpa-onnx');
    if (!mod) throw new Error('Missing react-native-sherpa-onnx. Install it for Android native Sherpa keyword/STT.');
    const modelDir = env('EXPO_PUBLIC_AGA_SHERPA_MODEL_DIR');
    const executionProvider = env('EXPO_PUBLIC_AGA_SHERPA_EXECUTION_PROVIDER') || 'xnnpack';
    const materialized = this.materializeKeywords(config.keywords);

    // The community package has changed APIs across builds. Support the common
    // shapes without hard-coding one wrapper name.
    const factory = mod.createKeywordSpotter || mod.createKws || mod.createKeywordRecognizer || mod.KeywordSpotter?.create || mod.SherpaOnnxKws?.create;
    if (factory) {
      this.nativeInstance = await factory({
        modelDir,
        executionProvider,
        keywords: materialized.phrases,
        keywordText: materialized.keywordText,
        mode: config.mode,
        onKeyword: (event: any) => this.acceptText(String(event?.text || event?.keyword || event?.phrase || event?.label || '')),
        onText: (text: string) => this.acceptText(text),
      });
      await this.nativeInstance?.start?.();
      this.callbacks.onStatus?.(`sherpa native keyword engine listening (${config.mode})`);
      return;
    }

    const manager = mod.SherpaOnnx || mod.default;
    if (manager?.startKeywordSpotting) {
      this.nativeInstance = manager;
      await manager.startKeywordSpotting({
        modelDir,
        executionProvider,
        keywords: materialized.phrases,
        keywordText: materialized.keywordText,
      }, (event: any) => this.acceptText(String(event?.keyword || event?.text || event || '')));
      this.callbacks.onStatus?.(`sherpa native keyword engine listening (${config.mode})`);
      return;
    }

    throw new Error('react-native-sherpa-onnx is installed, but no supported keyword spotting API was found. Add a small adapter in sherpaKeywordEngine.ts for your exact module export.');
  }

  private async startWasm(config: KeywordEngineConfig) {
    const mod = await optionalImport('sherpa-onnx-wasm') || await optionalImport('sherpa-onnx-web');
    if (!mod) {
      throw new Error('Missing sherpa-onnx WASM package/assets. Browser preview needs Sherpa WASM or explicit dev injector.');
    }
    const modelUrl = env('EXPO_PUBLIC_AGA_SHERPA_WASM_MODEL_URL') || '/sherpa/kws';
    const materialized = this.materializeKeywords(config.keywords);
    const factory = mod.createKeywordSpotter || mod.createKws || mod.KeywordSpotter?.create || mod.createRecognizer;
    if (!factory) throw new Error('Sherpa WASM package loaded, but no supported keyword spotter factory was found.');
    this.nativeInstance = await factory({
      modelUrl,
      keywords: materialized.phrases,
      keywordText: materialized.keywordText,
      onKeyword: (event: any) => this.acceptText(String(event?.text || event?.keyword || event?.phrase || event || '')),
      onText: (text: string) => this.acceptText(text),
    });
    await this.nativeInstance?.start?.();
    this.callbacks.onStatus?.(`sherpa WASM keyword engine listening (${config.mode})`);
  }
}

export class DevSherpaKeywordInjector implements KeywordEngine {
  private callbacks: KeywordEngineCallbacks;
  private config: KeywordEngineConfig | null = null;
  private running = false;

  constructor(callbacks: KeywordEngineCallbacks) {
    this.callbacks = callbacks;
  }

  getDiagnostics() {
    return { provider: 'dev_keyword', running: this.running, mode: this.config?.mode, command: '__AGA_SAY("two") / __AGA_WAKE()' };
  }

  async start(config: KeywordEngineConfig) {
    this.config = config;
    this.running = true;
    const g = root();
    g.__AGA_SAY = (text: string) => this.accept(text);
    g.__AGA_WAKE = () => this.accept('aga');
    g.__AGA_STOP = () => this.accept('stop');
    g.__AGA_PAUSE = () => this.accept('pause');
    g.__AGA_CHOOSE = (choice: string | number) => this.accept(String(choice));
    g.__AGA_REPEAT = () => this.accept('repeat options');
    this.callbacks.onStatus?.('dev Sherpa keyword injector ready');
  }

  async stop() {
    this.running = false;
    const g = root();
    for (const key of ['__AGA_SAY', '__AGA_WAKE', '__AGA_STOP', '__AGA_PAUSE', '__AGA_CHOOSE', '__AGA_REPEAT']) {
      if (g[key]) g[key] = undefined;
    }
  }

  private accept(text: string) {
    if (!this.running || !this.config) return;
    const match = matchKeywordText(text, this.config.keywords);
    if (match) this.callbacks.onKeyword(toEvent(match, 'dev_keyword', this.config));
    else if (this.config.allowTextFallback) this.callbacks.onText?.(text, 'dev_keyword');
  }
}

export function createSherpaKeywordEngine(callbacks: KeywordEngineCallbacks, provider?: KeywordEngineProvider | 'sherpa' | 'auto'): KeywordEngine {
  const requested = String(provider || env('EXPO_PUBLIC_AGA_KEYWORD_ENGINE') || 'sherpa').toLowerCase();
  if (requested === 'dev' || requested === 'dev_keyword') return new DevSherpaKeywordInjector(callbacks);
  if (requested === 'sherpa_wasm') return new SherpaKeywordEngine(callbacks, 'sherpa_wasm');
  if (requested === 'sherpa_native') return new SherpaKeywordEngine(callbacks, 'sherpa_native');
  if (requested === 'sherpa' || requested === 'auto') return new SherpaKeywordEngine(callbacks, providerForPlatform());
  return new SherpaKeywordEngine(callbacks, providerForPlatform());
}
