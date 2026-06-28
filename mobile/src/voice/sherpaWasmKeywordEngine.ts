import type { KeywordEngine, KeywordEngineConfig, WakeEngineEvent } from './wakeEngine';
import { startSherpaWasmKwsRuntime } from './sherpaWasmKwsRuntime';
import { emitWakeDebug } from './wakeDebugBus';
import { publishVoiceTelemetry } from './voiceTelemetryStore';

type StopHandle = {
  stop: () => Promise<void>;
  diagnostics?: unknown;
  runtimeKind?: string;
  exportKeys?: string[];
};

type SharedRuntime = {
  promise: Promise<StopHandle> | null;
  runtime: StopHandle | null;
  starts: number;
  subscribers: number;
  keywordsKey: string;
};

const shared: SharedRuntime = {
  promise: null,
  runtime: null,
  starts: 0,
  subscribers: 0,
  keywordsKey: '',
};

function normalizeKeyword(keyword: string) {
  const clean = String(keyword || '').toLowerCase().trim();
  if (clean.includes('aga')) return 'aga';
  if (clean.includes('stop')) return 'stop';
  if (clean.includes('pause')) return 'pause';
  return clean;
}

function defaultKeywords(config: KeywordEngineConfig = {}) {
  return (config.keywords || config.wakeKeywords ||
    String((process as any)?.env?.EXPO_PUBLIC_AGA_SHERPA_WAKE_KEYWORDS || 'aga,stop,pause')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean));
}

function keywordKey(keywords: string[]) {
  return keywords.map((k) => k.toLowerCase().trim()).filter(Boolean).sort().join('|');
}

function globalFlag() {
  return typeof window !== 'undefined' ? (window as any) : globalThis as any;
}

export class SherpaWasmKeywordEngine implements KeywordEngine {
  private listeners = new Set<(event: WakeEngineEvent) => void>();
  private running = false;
  private instanceId = `sherpa-wasm-${Math.random().toString(36).slice(2, 8)}`;

  async start(config: KeywordEngineConfig = {}) {
    if (this.running) return;
    this.running = true;
    shared.subscribers += 1;

    const keywords = defaultKeywords(config);
    const key = keywordKey(keywords);
    const root = globalFlag();

    if (root.__AGA_SHERPA_WASM_RUNNING__ && shared.runtime) {
      this.emit({
        type: 'status',
        provider: 'sherpa-wasm',
        message: `Sherpa WASM already running; attached ${this.instanceId}.`,
        raw: { subscribers: shared.subscribers, owner: root.__AGA_SHERPA_WASM_RUNNING__ },
      });
      return;
    }

    try {
      this.emit({
        type: 'status',
        provider: 'sherpa-wasm',
        message: `Starting Sherpa WASM KWS once for: ${keywords.join(', ')}`,
      });

      publishVoiceTelemetry({
        phase: 'wake_listening',
        provider: 'sherpa-wasm',
        wakeEngine: 'sherpa_wasm',
        status: `Starting Sherpa WASM: ${keywords.join(', ')}`,
      });

      if (!shared.promise || shared.keywordsKey !== key) {
        shared.starts += 1;
        shared.keywordsKey = key;
        root.__AGA_SHERPA_WASM_RUNNING__ = this.instanceId;
        root.__AGA_SHERPA_WASM_STARTS__ = shared.starts;

        shared.promise = startSherpaWasmKwsRuntime({
          keywords,
          onStatus: (status) => {
            const event: WakeEngineEvent = {
              type: 'status',
              provider: 'sherpa-wasm',
              keyword: status,
              message: status,
              raw: { status },
            };
            emitWakeDebug({ type: 'status', provider: 'sherpa-wasm', message: status, raw: { status } });
            this.emit(event);
          },
          onKeyword: (event) => {
            const keyword = normalizeKeyword(event.phrase || event.id);
            const index = keywords.findIndex((candidate) => keyword.includes(candidate.toLowerCase()));
            const wakeEvent: WakeEngineEvent = {
              type: 'keyword',
              provider: 'sherpa-wasm',
              keyword,
              index: index >= 0 ? index : undefined,
              confidence: event.confidence,
              raw: event.raw,
            };

            emitWakeDebug({
              type: 'keyword',
              provider: 'sherpa-wasm',
              keyword,
              index: wakeEvent.index,
              confidence: event.confidence,
              raw: event.raw,
            });

            this.emit(wakeEvent);
          },
        }).then((runtime) => {
          shared.runtime = runtime;
          return runtime;
        });
      }

      const runtime = await shared.promise;
      this.emit({
        type: 'status',
        provider: 'sherpa-wasm',
        message: `Sherpa WASM listening (${runtime.runtimeKind || 'runtime'}).`,
        raw: {
          singleton: true,
          starts: shared.starts,
          subscribers: shared.subscribers,
          diagnostics: runtime.diagnostics,
          runtimeKind: runtime.runtimeKind,
          exportKeys: runtime.exportKeys,
        },
      });
    } catch (error) {
      this.running = false;
      shared.subscribers = Math.max(0, shared.subscribers - 1);
      shared.promise = null;
      shared.runtime = null;
      root.__AGA_SHERPA_WASM_RUNNING__ = null;
      const message = error instanceof Error ? error.message : String(error);
      console.error('[aga:sherpa-wasm-keyword] failed', error);
      emitWakeDebug({ type: 'error', provider: 'sherpa-wasm', message, raw: error });
      this.emit({ type: 'error', provider: 'sherpa-wasm', message, raw: error });
      throw new Error(`Sherpa web runtime missing or failed: ${message}`);
    }
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    shared.subscribers = Math.max(0, shared.subscribers - 1);

    // Do not stop the shared runtime while another mounted screen/controller uses it.
    if (shared.subscribers > 0) {
      this.emit({
        type: 'status',
        provider: 'sherpa-wasm',
        message: `Sherpa WASM kept alive for ${shared.subscribers} subscriber(s).`,
      });
      return;
    }

    const runtime = shared.runtime;
    shared.runtime = null;
    shared.promise = null;
    shared.keywordsKey = '';
    const root = globalFlag();
    root.__AGA_SHERPA_WASM_RUNNING__ = null;

    if (runtime) await runtime.stop();
  }

  subscribe(listener: (event: WakeEngineEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: WakeEngineEvent) {
    for (const listener of Array.from(this.listeners)) listener(event);
  }
}
