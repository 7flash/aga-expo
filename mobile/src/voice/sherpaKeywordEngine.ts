import { Platform } from 'react-native';
import {
  matchKeywordText,
  type KeywordEngine,
  type KeywordEngineCallbacks,
  type KeywordEngineConfig,
  type KeywordEngineProvider,
  type KeywordEvent,
  type KeywordPhrase,
} from './keywordEngine';
import { compileSherpaKeywords, keywordDebugTable, type CompiledSherpaKeywords } from './sherpaKeywordCompiler';
import { resolveSherpaManifest, sherpaManifestSummary, shouldAllowDevKeywordFallback, validateSherpaManifest } from './sherpaModelManifest';

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

function targetFromProvider(provider: KeywordEngineProvider) {
  return provider === 'sherpa_wasm' ? 'wasm' : 'native';
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
  private compiled: CompiledSherpaKeywords | null = null;
  private manifest: ReturnType<typeof resolveSherpaManifest> | null = null;

  constructor(callbacks: KeywordEngineCallbacks, provider: KeywordEngineProvider = providerForPlatform()) {
    this.callbacks = callbacks;
    this.provider = provider;
  }

  getDiagnostics() {
    return {
      provider: this.provider,
      running: this.running,
      mode: this.config?.mode,
      detections: this.detections,
      lastError: this.lastError,
      keywords: this.compiled ? keywordDebugTable(this.compiled) : null,
      sherpa: this.manifest ? sherpaManifestSummary(this.manifest) : null,
    };
  }

  async start(config: KeywordEngineConfig) {
    if (this.running) await this.stop('restart');
    this.config = config;
    this.running = true;
    this.detections = 0;
    this.compiled = compileSherpaKeywords(config.keywords || []);
    this.manifest = resolveSherpaManifest(config.mode === 'wake' ? 'wake' : 'menu', targetFromProvider(this.provider) as any);
    const validation = validateSherpaManifest(this.manifest);
    if (!validation.ok) {
      this.lastError = validation.message;
      throw new Error(validation.message);
    }

    const timeoutMs = config.timeoutMs || Number(env('EXPO_PUBLIC_AGA_POST_WAKE_COMMAND_WINDOW_MS') || 8000);
    if (config.mode !== 'wake' && timeoutMs > 0) {
      this.noMatchTimer = setTimeout(() => this.callbacks.onNoMatch?.('timeout'), timeoutMs);
    }

    try {
      if (this.provider === 'sherpa_wasm') await this.startWasm(config, this.compiled, this.manifest);
      else await this.startNative(config, this.compiled, this.manifest);
    } catch (error) {
      this.running = false;
      this.lastError = error instanceof Error ? error.message : String(error || 'sherpa start failed');
      this.callbacks.onError?.(this.lastError);
      throw error;
    }
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
    this.compiled = compileSherpaKeywords(keywords);
    if (this.nativeInstance?.setKeywords) {
      await this.nativeInstance.setKeywords(this.materializeForAdapter(this.compiled));
    }
  }

  private materializeForAdapter(compiled: CompiledSherpaKeywords) {
    return {
      phrases: compiled.phrases,
      entries: compiled.entries,
      keywordText: compiled.keywordText,
      phraseToId: compiled.phraseToId,
      digest: compiled.digest,
    };
  }

  private acceptText(text: string, confidence?: number) {
    if (!this.running || !this.config) return;
    const clean = String(text || '').trim();
    if (!clean) return;
    const match = matchKeywordText(clean, this.config.keywords);
    if (match) {
      this.detections += 1;
      if (this.noMatchTimer) clearTimeout(this.noMatchTimer);
      this.noMatchTimer = null;
      this.callbacks.onKeyword(toEvent({ ...match, confidence: confidence ?? match.confidence }, this.provider, this.config));
      return;
    }
    if (this.config.allowTextFallback) this.callbacks.onText?.(clean, this.provider);
  }

  private async startNative(config: KeywordEngineConfig, compiled: CompiledSherpaKeywords, manifest: NonNullable<typeof this.manifest>) {
    const mod = await optionalImport('react-native-sherpa-onnx');
    if (!mod) throw new Error('Missing react-native-sherpa-onnx. Android appliance builds need Sherpa native; do not fall back to Android SpeechRecognizer.');
    const materialized = this.materializeForAdapter(compiled);
    const commonConfig = {
      ...manifest,
      modelDir: manifest.modelDir,
      executionProvider: manifest.provider,
      keywords: materialized.phrases,
      keywordText: materialized.keywordText,
      mode: config.mode,
    };

    const factory = mod.createKeywordSpotter || mod.createKws || mod.createKeywordRecognizer || mod.KeywordSpotter?.create || mod.SherpaOnnxKws?.create;
    if (factory) {
      this.nativeInstance = await factory({
        ...commonConfig,
        onKeyword: (event: any) => this.acceptText(String(event?.text || event?.keyword || event?.phrase || event?.label || ''), Number(event?.confidence)),
        onText: (text: string) => this.acceptText(text),
      });
      await this.nativeInstance?.start?.();
      this.callbacks.onStatus?.(`sherpa native ${config.mode} listening (${compiled.phrases.length} phrases, ${compiled.digest})`);
      return;
    }

    const manager = mod.SherpaOnnx || mod.default;
    if (manager?.startKeywordSpotting) {
      this.nativeInstance = manager;
      await manager.startKeywordSpotting(commonConfig, (event: any) => this.acceptText(String(event?.keyword || event?.text || event || ''), Number(event?.confidence)));
      this.callbacks.onStatus?.(`sherpa native ${config.mode} listening (${compiled.phrases.length} phrases, ${compiled.digest})`);
      return;
    }

    throw new Error('react-native-sherpa-onnx is installed, but no supported KWS adapter was found. Add a tiny adapter in sherpaKeywordEngine.ts for your exact module export.');
  }

  private async startWasm(config: KeywordEngineConfig, compiled: CompiledSherpaKeywords, manifest: NonNullable<typeof this.manifest>) {
    const mod = await optionalImport('sherpa-onnx-wasm') || await optionalImport('sherpa-onnx-web');
    if (!mod) throw new Error('Missing Sherpa WASM package. Browser preview should use sherpa-onnx-wasm/web assets, not browser SpeechRecognition.');
    const materialized = this.materializeForAdapter(compiled);
    const commonConfig = {
      ...manifest,
      modelUrl: manifest.modelUrl,
      keywords: materialized.phrases,
      keywordText: materialized.keywordText,
      mode: config.mode,
    };
    const factory = mod.createKeywordSpotter || mod.createKws || mod.KeywordSpotter?.create || mod.createRecognizer;
    if (!factory) throw new Error('Sherpa WASM package loaded, but no supported keyword spotter factory was found.');
    this.nativeInstance = await factory({
      ...commonConfig,
      onKeyword: (event: any) => this.acceptText(String(event?.text || event?.keyword || event?.phrase || event || ''), Number(event?.confidence)),
      onText: (text: string) => this.acceptText(text),
    });
    await this.nativeInstance?.start?.();
    this.callbacks.onStatus?.(`sherpa WASM ${config.mode} listening (${compiled.phrases.length} phrases, ${compiled.digest})`);
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
    return { provider: 'dev_keyword', running: this.running, mode: this.config?.mode, enabledBy: 'EXPO_PUBLIC_AGA_ALLOW_DEV_KEYWORD_INJECTOR=1' };
  }

  async start(config: KeywordEngineConfig) {
    if (!shouldAllowDevKeywordFallback()) throw new Error('Dev keyword injector is disabled. Set EXPO_PUBLIC_AGA_ALLOW_DEV_KEYWORD_INJECTOR=1 only for browser harness testing.');
    this.config = config;
    this.running = true;
    const g = root();
    g.__AGA_SAY = (text: string) => this.accept(text);
    g.__AGA_WAKE = () => this.accept('aga');
    g.__AGA_STOP = () => this.accept('stop');
    g.__AGA_PAUSE = () => this.accept('pause');
    g.__AGA_CHOOSE = (choice: string | number) => this.accept(String(choice));
    g.__AGA_REPEAT = () => this.accept('repeat options');
    this.callbacks.onStatus?.('dev keyword injector ready');
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
