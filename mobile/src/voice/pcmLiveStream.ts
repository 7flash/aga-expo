import { measureMark } from '../observability/measure';

declare function require(name: string): any;

export type PcmFrame = {
  pcm16Base64: string;
  sampleRate: number;
  channels: number;
};

export type PcmLiveTarget = 'openai' | 'gemini';

export type PcmLiveStreamerOptions = {
  target: PcmLiveTarget;
  sendJson: (value: unknown) => boolean | void;
  onStatus?: (status: string) => void;
  onError?: (message: string) => void;
};

/**
 * Facade for the post-wake raw-audio path.
 *
 * Porcupine owns always-on audio. After "aga" fires, this optional native module
 * can stream PCM frames into Gemini/OpenAI realtime. If the module is absent,
 * sessions still work through their own duplex implementations or text replay.
 */
export class PcmLiveStreamer {
  private options: PcmLiveStreamerOptions;
  private recorder: any | null = null;
  private started = false;

  constructor(options: PcmLiveStreamerOptions) {
    this.options = options;
  }

  isAvailable() {
    try {
      const req = (0, eval)('typeof require !== "undefined" ? require : null');
      const mod = req?.('aga-native-pcm-stream');
      return !!(mod?.createPcmStream || mod?.default?.createPcmStream);
    } catch {
      return false;
    }
  }

  async start() {
    if (this.started) return false;
    try {
      const req = (0, eval)('typeof require !== "undefined" ? require : null');
      const mod = req?.('aga-native-pcm-stream');
      const create = mod?.createPcmStream || mod?.default?.createPcmStream;
      if (!create) {
        this.options.onStatus?.('native PCM stream unavailable; using session fallback');
        return false;
      }
      this.recorder = create({
        sampleRate: 16000,
        channels: 1,
        onFrame: (frame: PcmFrame) => this.sendFrame(frame),
        onError: (message: string) => this.options.onError?.(message),
      });
      await this.recorder.start?.();
      this.started = true;
      this.options.onStatus?.('native PCM stream active');
      measureMark('voice.pcm.start', { target: this.options.target });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'PCM stream failed');
      this.options.onError?.(message);
      return false;
    }
  }

  async stop() {
    if (!this.started && !this.recorder) return;
    try { await this.recorder?.stop?.(); } catch { /* ignore */ }
    this.recorder = null;
    this.started = false;
    measureMark('voice.pcm.stop', { target: this.options.target });
  }

  private sendFrame(frame: PcmFrame) {
    if (this.options.target === 'openai') {
      this.options.sendJson({ type: 'input_audio_buffer.append', audio: frame.pcm16Base64 });
      return;
    }
    this.options.sendJson({
      realtime_input: {
        media_chunks: [{ mime_type: `audio/pcm;rate=${frame.sampleRate}`, data: frame.pcm16Base64 }],
      },
    });
  }
}
