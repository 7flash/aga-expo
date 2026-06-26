import { NativeEventEmitter, NativeModules } from 'react-native';
import { logEvent } from '../db/localStore';

export type PcmChunk = {
  base64: string;
  sampleRate: number;
  channels: number;
  timestampMs: number;
  isLeadIn?: boolean;
};

type DirectAudioSink = {
  appendPcm: (chunk: PcmChunk) => void | Promise<void>;
  commit?: () => void | Promise<void>;
  close?: () => void | Promise<void>;
};

type NativePcmModule = {
  isAvailable?: () => Promise<boolean>;
  start?: (options: Record<string, unknown>) => Promise<void>;
  stop?: () => Promise<void>;
};

function nativeModule(): NativePcmModule | null {
  return (NativeModules as any)?.AgaPcmCapture ?? null;
}

/**
 * Direct PCM bridge used after wake.
 *
 * It bypasses Android SpeechRecognizer final-text latency. Native captures raw
 * PCM and streams it to a realtime transport. If the native module is absent,
 * callers should fall back to local STT/text turns.
 */
export class PcmRealtimeStream {
  private sub: { remove?: () => void } | null = null;
  private sink: DirectAudioSink | null = null;
  private active = false;

  async available() {
    const mod = nativeModule();
    if (!mod?.isAvailable) return false;
    try { return !!await mod.isAvailable(); } catch { return false; }
  }

  async start(sink: DirectAudioSink, options: { sampleRate?: number; channels?: number; leadInBase64?: string } = {}) {
    const mod = nativeModule();
    if (!mod?.start || !await this.available()) return false;
    this.sink = sink;
    if (options.leadInBase64) {
      await Promise.resolve(sink.appendPcm({ base64: options.leadInBase64, sampleRate: options.sampleRate || 16000, channels: options.channels || 1, timestampMs: Date.now(), isLeadIn: true }));
    }
    const emitter = new NativeEventEmitter(NativeModules as any);
    this.sub?.remove?.();
    this.sub = emitter.addListener('AgaPcmChunk', (raw: any) => {
      const chunk: PcmChunk = {
        base64: String(raw?.base64 || ''),
        sampleRate: Number(raw?.sampleRate || options.sampleRate || 16000),
        channels: Number(raw?.channels || options.channels || 1),
        timestampMs: Number(raw?.timestampMs || Date.now()),
      };
      if (chunk.base64) void Promise.resolve(this.sink?.appendPcm(chunk)).catch(() => undefined);
    });
    await mod.start({ sampleRate: options.sampleRate || 16000, channels: options.channels || 1, frameMs: 20, echoCancellation: true, noiseSuppression: true });
    this.active = true;
    await logEvent('voice.pcm_stream.start', `${options.sampleRate || 16000}hz`).catch(() => undefined);
    return true;
  }

  async stop(commit = true) {
    this.sub?.remove?.();
    this.sub = null;
    this.active = false;
    try { await nativeModule()?.stop?.(); } catch { /* ignore */ }
    try {
      if (commit) await this.sink?.commit?.();
      else await this.sink?.close?.();
    } finally {
      this.sink = null;
    }
  }

  isActive() { return this.active; }
}
