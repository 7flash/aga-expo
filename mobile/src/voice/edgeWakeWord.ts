import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { logEvent } from '../db/localStore';

type WakeCallbacks = {
  onWake?: (event: EdgeWakeEvent) => void;
  onError?: (message: string) => void;
  onStatus?: (status: string) => void;
};

export type EdgeWakeEvent = {
  phrase: string;
  confidence: number;
  at: string;
  engine: 'porcupine' | 'sherpa_onnx' | 'native_optional';
  pcmLeadInBase64?: string;
};

export type EdgeWakeDiagnostics = {
  available: boolean;
  engine: string;
  listening: boolean;
  detections: number;
  lastWakeAt: string | null;
  lastError: string | null;
};

type NativeEdgeWakeModule = {
  isAvailable?: () => Promise<boolean>;
  start?: (options: Record<string, unknown>) => Promise<void>;
  stop?: () => Promise<void>;
  diagnostics?: () => Promise<Record<string, unknown>>;
};

function env(name: string, fallback = '') {
  return String(process.env?.[name] ?? fallback);
}

function nativeModule(): NativeEdgeWakeModule | null {
  return (NativeModules as any)?.AgaEdgeWakeWord ?? null;
}

/**
 * Optional native wake-word facade.
 *
 * Production APKs should implement AgaEdgeWakeWord with Porcupine, Sherpa-ONNX,
 * or another local C++/JNI wake engine. JS never runs a continuous STT loop when
 * this is available; it only receives a wake event and an optional lead-in PCM
 * buffer after the local signature of “AGA” is detected.
 */
export class EdgeWakeWordLoop {
  private callbacks: WakeCallbacks;
  private sub: { remove?: () => void } | null = null;
  private listening = false;
  private detections = 0;
  private lastWakeAt: string | null = null;
  private lastError: string | null = null;

  constructor(callbacks: WakeCallbacks = {}) {
    this.callbacks = callbacks;
  }

  async available() {
    const mod = nativeModule();
    if (!mod?.isAvailable) return false;
    try { return !!await mod.isAvailable(); } catch { return false; }
  }

  async start(phrase = env('EXPO_PUBLIC_AGA_WAKE_WORD', 'aga')) {
    const mod = nativeModule();
    if (!mod?.start || !await this.available()) {
      this.callbacks.onStatus?.('edge wake unavailable; falling back to speech loop');
      return false;
    }

    const emitter = new NativeEventEmitter(NativeModules as any);
    this.sub?.remove?.();
    this.sub = emitter.addListener('AgaEdgeWakeWordDetected', (raw: any) => {
      const event: EdgeWakeEvent = {
        phrase: String(raw?.phrase || phrase),
        confidence: Number(raw?.confidence ?? 1),
        at: new Date().toISOString(),
        engine: String(raw?.engine || 'native_optional') as EdgeWakeEvent['engine'],
        pcmLeadInBase64: typeof raw?.pcmLeadInBase64 === 'string' ? raw.pcmLeadInBase64 : undefined,
      };
      this.detections += 1;
      this.lastWakeAt = event.at;
      this.callbacks.onWake?.(event);
    });

    try {
      await mod.start({
        phrase,
        sensitivity: Number(env('EXPO_PUBLIC_AGA_WAKE_SENSITIVITY', '0.55')),
        sampleRate: 16000,
        frameMs: 32,
        emitLeadInMs: Number(env('EXPO_PUBLIC_AGA_WAKE_LEADIN_MS', '900')),
        engineHint: env('EXPO_PUBLIC_AGA_EDGE_WAKE', 'optional_native'),
      });
      this.listening = true;
      this.callbacks.onStatus?.(`edge wake active on ${Platform.OS}`);
      await logEvent('voice.edge_wake.start', phrase).catch(() => undefined);
      return true;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error || 'edge wake failed');
      this.callbacks.onError?.(this.lastError);
      await logEvent('voice.edge_wake.error', this.lastError).catch(() => undefined);
      return false;
    }
  }

  async stop() {
    this.sub?.remove?.();
    this.sub = null;
    this.listening = false;
    try { await nativeModule()?.stop?.(); } catch { /* ignore native stop noise */ }
  }

  async diagnostics(): Promise<EdgeWakeDiagnostics> {
    const native = await nativeModule()?.diagnostics?.().catch(() => null);
    return {
      available: await this.available(),
      engine: String(native?.engine || env('EXPO_PUBLIC_AGA_EDGE_WAKE', 'optional_native')),
      listening: this.listening,
      detections: this.detections,
      lastWakeAt: this.lastWakeAt,
      lastError: this.lastError,
    };
  }
}
