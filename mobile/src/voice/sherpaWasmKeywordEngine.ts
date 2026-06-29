import type { KeywordEngine, KeywordEngineConfig, WakeEngineEvent } from './wakeEngine';
import { startSherpaWasmKwsRuntime } from './sherpaWasmKwsRuntime';
import { emitWakeDebug } from './wakeDebugBus';
import { publishVoiceTelemetry } from './voiceTelemetryStore';
import { getOrStartSherpaRuntime, stopSharedSherpaRuntime } from './sherpaRuntimeSingleton';

type RuntimeHandle = { stop?: () => Promise<void> | void; diagnostics?: unknown; runtimeKind?: string; [key: string]: unknown };

function normalizeKeyword(keyword: string) {
  const clean = String(keyword || '').toLowerCase().trim();
  if (clean.includes('aga')) return 'aga';
  if (clean.includes('stop')) return 'stop';
  if (clean.includes('pause')) return 'pause';
  return clean;
}

function defaultKeywords(config: KeywordEngineConfig = {}) {
  return (config.keywords || config.wakeKeywords || String((process as any)?.env?.EXPO_PUBLIC_AGA_SHERPA_WAKE_KEYWORDS || 'aga,stop,pause')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean));
}

function keywordKey(keywords: string[]) {
  return keywords.map((k) => k.toLowerCase().trim()).filter(Boolean).sort().join('|');
}

export class SherpaWasmKeywordEngine implements KeywordEngine {
  private listeners = new Set<(event: WakeEngineEvent) => void>();
  private running = false;
  private runtime: RuntimeHandle | null = null;
  private instanceId = `sherpa-wasm-${Math.random().toString(36).slice(2, 8)}`;

  async start(config: KeywordEngineConfig = {}) {
    if (this.running) return;
    this.running = true;

    const keywords = defaultKeywords(config);
    const key = keywordKey(keywords);

    this.emit({ type: 'status', provider: 'sherpa-wasm', message: `starting Sherpa WASM singleton (${key || 'no-keywords'})` });
    publishVoiceTelemetry({ phase: 'wake_listening', wakeEngine: 'sherpa_wasm', provider: 'sherpa-wasm', status: 'starting Sherpa WASM' });

    try {
      this.runtime = await getOrStartSherpaRuntime(key, async () => {
        return await startSherpaWasmKwsRuntime({
          ...config,
          keywords,
          onAudio: (audio: any) => {
            emitWakeDebug({ type: 'audio', provider: 'sherpa-wasm', rms: Number(audio.rms || 0), peak: Number(audio.peak || 0), frames: Number(audio.frames || 0), raw: audio });
          },
          onKeyword: (keywordEvent: any) => {
            const keyword = normalizeKeyword(keywordEvent.keyword || keywordEvent.phrase || keywordEvent.id || 'aga');
            const fallback = !!keywordEvent.fallback || !!keywordEvent.raw?.fallback || /text2token did not create output/i.test(String(keywordEvent.reason || keywordEvent.raw?.reason || ''));
            const event: WakeEngineEvent = {
              type: 'keyword',
              provider: 'sherpa-wasm',
              keyword,
              confidence: fallback ? 0.25 : Number(keywordEvent.confidence ?? 1),
              raw: { ...keywordEvent, fallback },
            } as WakeEngineEvent;
            this.emit(event);
          },
          onStatus: (status: any) => {
            this.emit({ type: 'status', provider: 'sherpa-wasm', message: String(status.message || status.status || status), raw: status });
          },
          onError: (error: any) => {
            this.emit({ type: 'error', provider: 'sherpa-wasm', message: error instanceof Error ? error.message : String(error), raw: error });
          },
        } as any);
      });

      this.emit({ type: 'status', provider: 'sherpa-wasm', message: `Sherpa WASM attached by ${this.instanceId}`, raw: { runtimeKind: this.runtime.runtimeKind, diagnostics: this.runtime.diagnostics } });
    } catch (error) {
      this.emit({ type: 'error', provider: 'sherpa-wasm', message: error instanceof Error ? error.message : String(error), raw: error });
      this.running = false;
      throw error;
    }
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    // Labs can explicitly stop shared runtime. Main app should normally keep it alive.
    await stopSharedSherpaRuntime().catch(() => {});
    this.emit({ type: 'status', provider: 'sherpa-wasm', message: `Sherpa WASM stopped by ${this.instanceId}` });
  }

  subscribe(listener: (event: WakeEngineEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  on(listener: (event: WakeEngineEvent) => void) {
    return this.subscribe(listener);
  }

  private emit(event: WakeEngineEvent) {
    const raw: any = (event as any).raw;
    if (event.type === 'keyword') {
      const fallback = !!raw?.fallback;
      emitWakeDebug({
        type: 'keyword',
        provider: 'sherpa-wasm',
        keyword: (event as any).keyword || 'aga',
        confidence: fallback ? 0.25 : (event as any).confidence ?? 1,
        raw: { ...raw, fallback },
      });
      publishVoiceTelemetry({
        phase: 'wake_detected',
        wakeEngine: fallback ? 'volume' : 'sherpa_wasm',
        provider: 'sherpa-wasm',
        wakeKeyword: (event as any).keyword || 'aga',
        wakeConfidence: fallback ? 0.25 : (event as any).confidence ?? 1,
        commandWindowActive: true,
        micOpen: true,
        canAcceptUserSpeech: true,
        status: fallback ? 'Sherpa fallback only — text2token failed' : `Sherpa keyword: ${(event as any).keyword || 'aga'}`,
      });
    } else if (event.type === 'status') {
      emitWakeDebug({ type: 'status', provider: 'sherpa-wasm', message: (event as any).message || 'status', raw });
    } else if (event.type === 'error') {
      emitWakeDebug({ type: 'error', provider: 'sherpa-wasm', message: (event as any).message || 'Sherpa error', raw });
    }

    for (const listener of Array.from(this.listeners)) {
      try { listener(event); } catch {}
    }
  }
}
