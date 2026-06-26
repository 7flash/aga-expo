import { Platform } from 'react-native';

export type PorcupineWebDetection = { index: number; label: string };

export type PorcupineWebCallbacks = {
  onDetected: (event: PorcupineWebDetection) => void;
  onStatus?: (status: string) => void;
  onError?: (message: string) => void;
};

function env(name: string) {
  return process.env?.[name] ?? '';
}

function splitEnv(name: string, fallback: string[]) {
  const raw = String(env(name) || '').trim();
  if (!raw) return fallback;
  return raw.split(',').map((part) => part.trim()).filter(Boolean);
}

function boolEnv(name: string, fallback: boolean) {
  const raw = String(env(name) || '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

async function optionalImport(specifier: string): Promise<any | null> {
  try {
    // Keep this dynamic so native bundles do not require the web package.
    return await (Function('s', 'return import(s)') as any)(specifier);
  } catch {
    return null;
  }
}

function labels() {
  return splitEnv('EXPO_PUBLIC_AGA_PORCUPINE_LABELS', ['aga', 'stop', 'pause']);
}

function webKeywords() {
  // Web .ppn assets must be trained/downloaded for Web/WASM, not Android.
  return splitEnv('EXPO_PUBLIC_AGA_PORCUPINE_WEB_KEYWORDS', ['/porcupine/aga_web.ppn', '/porcupine/stop_web.ppn', '/porcupine/pause_web.ppn']);
}

/**
 * Browser Porcupine/WASM wake engine.
 *
 * This class intentionally fails loud if the web assets are missing. It does not
 * silently fall back to browser SpeechRecognition, because SpeechRecognition is
 * not the agreed always-on architecture.
 */
export class PorcupineWebWakeEngine {
  private callbacks: PorcupineWebCallbacks;
  private worker: any | null = null;
  private voiceProcessor: any | null = null;
  private running = false;
  private lastError: string | null = null;

  constructor(callbacks: PorcupineWebCallbacks) {
    this.callbacks = callbacks;
  }

  getDiagnostics() {
    return {
      provider: 'porcupine-web',
      platform: Platform.OS,
      running: this.running,
      keywordCount: webKeywords().length,
      labels: labels(),
      lastError: this.lastError,
      devFallbackHint: 'Set EXPO_PUBLIC_AGA_WEB_WAKE_ENGINE=dev to test without web .ppn assets.',
    };
  }

  async start() {
    if (this.running) return;
    if (Platform.OS !== 'web') throw new Error('Porcupine Web wake engine can only run on web.');
    const accessKey = env('EXPO_PUBLIC_PICOVOICE_ACCESS_KEY') || env('EXPO_PUBLIC_PORCUPINE_ACCESS_KEY');
    if (!accessKey) throw new Error('Missing EXPO_PUBLIC_PICOVOICE_ACCESS_KEY for Porcupine Web.');

    const mod = await optionalImport('@picovoice/porcupine-web');
    if (!mod) {
      throw new Error('Missing @picovoice/porcupine-web. Install it or set EXPO_PUBLIC_AGA_WEB_WAKE_ENGINE=dev for browser preview.');
    }

    const wvp = await optionalImport('@picovoice/web-voice-processor');
    const keywordPaths = webKeywords();
    const labelList = labels();
    const detectionCallback = (result: any) => {
      const index = Number(result?.keywordIndex ?? result?.index ?? result);
      const safeIndex = Number.isFinite(index) ? index : 0;
      this.callbacks.onDetected({ index: safeIndex, label: labelList[safeIndex] || `keyword_${safeIndex}` });
    };

    try {
      const Worker = mod.PorcupineWorker || mod.PorcupineWebWorker || mod.default;
      if (!Worker?.create) throw new Error('Porcupine Web module did not expose PorcupineWorker.create().');
      this.worker = await Worker.create(accessKey, keywordPaths, detectionCallback);
      this.voiceProcessor = wvp?.WebVoiceProcessor || mod.WebVoiceProcessor || null;
      if (!this.voiceProcessor?.subscribe) {
        if (boolEnv('EXPO_PUBLIC_AGA_PORCUPINE_WEB_ALLOW_MANUAL_PROCESSOR', false)) {
          this.callbacks.onStatus?.('Porcupine Web worker created; manual audio processor required by installed SDK version.');
        } else {
          throw new Error('Missing WebVoiceProcessor.subscribe(); install @picovoice/web-voice-processor or enable manual processor mode.');
        }
      } else {
        await this.voiceProcessor.subscribe(this.worker);
      }
      this.running = true;
      this.callbacks.onStatus?.('Porcupine Web listening for AGA / stop / pause');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'Porcupine Web failed');
      this.lastError = message;
      this.callbacks.onError?.(message);
      throw error;
    }
  }

  async stop() {
    this.running = false;
    try {
      if (this.voiceProcessor?.unsubscribe && this.worker) await this.voiceProcessor.unsubscribe(this.worker);
    } catch { /* ignore */ }
    try { await this.worker?.release?.(); } catch { /* ignore */ }
    try { await this.worker?.terminate?.(); } catch { /* ignore */ }
    this.worker = null;
    this.callbacks.onStatus?.('Porcupine Web stopped');
  }
}
