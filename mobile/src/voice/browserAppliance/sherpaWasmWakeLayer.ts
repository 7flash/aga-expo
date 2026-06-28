import { startSherpaWasmKwsRuntime } from '../sherpaWasmKwsRuntime';
import { diagnoseSherpaWasmBrowserRuntime } from '../sherpaWasmRuntimeDiagnostics';
import { createShortUtteranceRecorder, shortUtteranceCaptureMs } from '../shortUtteranceRecorder';
import type { BrowserApplianceListener, BrowserWakeLayer } from './types';

function env(name: string, fallback = '') {
  return String(process.env?.[name] ?? fallback);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SherpaWasmWakeLayer implements BrowserWakeLayer {
  readonly name = 'sherpa-wasm';
  private runtime: { stop?: () => Promise<void> | void; diagnostics?: unknown; runtimeKind?: string } | null = null;
  private listener: BrowserApplianceListener | null = null;
  private mutedUntil = 0;
  private lastDiagnostics: unknown = null;
  private capturing = false;

  async start(listener: BrowserApplianceListener) {
    this.listener = listener;
    this.lastDiagnostics = await diagnoseSherpaWasmBrowserRuntime().catch((error) => ({ ok: false, message: String(error) }));
    listener({ type: 'status', mode: 'wake-listening', message: 'Starting Sherpa WASM wake layer.', raw: this.lastDiagnostics });
    this.runtime = await startSherpaWasmKwsRuntime({
      modelBaseUrl: env('EXPO_PUBLIC_AGA_SHERPA_WASM_MODEL_URL', '/sherpa/kws-model'),
      keywords: env('EXPO_PUBLIC_AGA_SHERPA_WAKE_KEYWORDS', 'aga,stop,pause').split(',').map((x) => x.trim()).filter(Boolean),
      onStatus: (message) => listener({ type: 'status', message }),
      onKeyword: (event) => {
        if (Date.now() < this.mutedUntil || this.capturing) return;
        listener({ type: 'wake', provider: this.name, confidence: event.confidence, raw: event });
        void this.capturePostWakeUtterance();
      },
    });
  }

  mute(ms: number) {
    this.mutedUntil = Math.max(this.mutedUntil, Date.now() + Math.max(0, ms));
  }

  async stop() {
    await this.runtime?.stop?.();
    this.runtime = null;
    this.listener?.({ type: 'status', mode: 'idle', message: 'Sherpa WASM wake layer stopped.' });
  }

  getDiagnostics() {
    return { provider: this.name, mutedMs: Math.max(0, this.mutedUntil - Date.now()), lastDiagnostics: this.lastDiagnostics, runtime: this.runtime };
  }

  private async capturePostWakeUtterance() {
    if (!this.listener || this.capturing) return;
    this.capturing = true;
    const recorder = createShortUtteranceRecorder();
    try {
      this.listener({ type: 'status', mode: 'capturing', message: 'Wake word heard; capturing command audio.' });
      await recorder.start();
      await delay(shortUtteranceCaptureMs());
      const audio = await recorder.stop();
      if (audio) this.listener({ type: 'utterance', provider: this.name, audio, durationMs: audio.durationMs });
    } catch (error) {
      await recorder.cancel?.();
      this.listener({ type: 'error', message: error instanceof Error ? error.message : String(error), raw: error });
    } finally {
      this.capturing = false;
    }
  }
}
