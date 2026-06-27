import type { KeywordEngine, KeywordEngineConfig, WakeEngineEvent } from './wakeEngine';
import { startSherpaWasmKwsRuntime } from './sherpaWasmKwsRuntime';
import { emitWakeDebug } from './wakeDebugBus';

type StopHandle = {
  stop: () => Promise<void>;
  diagnostics?: unknown;
  runtimeKind?: string;
  exportKeys?: string[];
};

function normalizeKeyword(keyword: string) {
  const clean = String(keyword || '').toLowerCase().trim();
  if (clean.includes('aga')) return 'aga';
  if (clean.includes('stop')) return 'stop';
  if (clean.includes('pause')) return 'pause';
  return clean;
}

export class SherpaWasmKeywordEngine implements KeywordEngine {
  private listeners = new Set<(event: WakeEngineEvent) => void>();
  private runtime: StopHandle | null = null;
  private running = false;

  async start(config: KeywordEngineConfig = {}) {
    if (this.running) return;
    this.running = true;

    const keywords = config.keywords || config.wakeKeywords ||
      String((process as any)?.env?.EXPO_PUBLIC_AGA_SHERPA_WAKE_KEYWORDS || 'aga,stop,pause')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    try {
      this.emit({
        type: 'status',
        provider: 'sherpa-wasm',
        message: `Starting Sherpa WASM KWS for: ${keywords.join(', ')}`,
      });

      const runtime = await startSherpaWasmKwsRuntime({
        keywords,
        onStatus: (status) => {
          this.emit({
            type: 'status',
            provider: 'sherpa-wasm',
            keyword: status,
            message: status,
            raw: { status },
          });
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
      });

      this.runtime = runtime;
      this.emit({
        type: 'status',
        provider: 'sherpa-wasm',
        message: `Sherpa WASM listening (${runtime.runtimeKind || 'runtime'}).`,
        raw: {
          diagnostics: runtime.diagnostics,
          runtimeKind: runtime.runtimeKind,
          exportKeys: runtime.exportKeys,
        },
      });
    } catch (error) {
      this.running = false;
      this.runtime = null;
      const message = error instanceof Error ? error.message : String(error);
      console.error('[aga:sherpa-wasm-keyword] failed', error);
      emitWakeDebug({ type: 'error', provider: 'sherpa-wasm', message, raw: error });
      this.emit({
        type: 'error',
        provider: 'sherpa-wasm',
        message,
        raw: error,
      });
      throw new Error(`Sherpa web runtime missing or failed: ${message}`);
    }
  }

  async stop() {
    this.running = false;
    const runtime = this.runtime;
    this.runtime = null;
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
