import type { ShortUtteranceAudio } from '../shortUtteranceRecorder';
import type { BrowserApplianceListener, BrowserWakeLayer } from './types';
import { shouldBlockUserCapture, captureBlockedMs } from '../speakListenGate';

function env(name: string, fallback = '') {
  return String(process.env?.[name] ?? fallback);
}

function numberEnv(name: string, fallback: number) {
  const n = Number(env(name));
  return Number.isFinite(n) ? n : fallback;
}

type TimedChunk = { at: number; blob: Blob };

type Options = {
  threshold?: number;
  silenceThreshold?: number;
  holdMs?: number;
  silenceMs?: number;
  leadInMs?: number;
  maxUtteranceMs?: number;
  refractoryMs?: number;
};

function audioStats(samples: Uint8Array) {
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const centered = (samples[i] - 128) / 128;
    const abs = Math.abs(centered);
    peak = Math.max(peak, abs);
    sum += centered * centered;
  }
  return { rms: Math.sqrt(sum / Math.max(1, samples.length)), peak };
}

function supportedMimeType() {
  const M = (globalThis as any).MediaRecorder;
  const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return preferred.find((type) => M?.isTypeSupported?.(type)) || 'audio/webm';
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class VolumeThresholdWakeLayer implements BrowserWakeLayer {
  readonly name = 'volume-threshold';

  private options: Required<Options>;
  private listener: BrowserApplianceListener | null = null;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private recorder: MediaRecorder | null = null;
  private mimeType = 'audio/webm';
  private frame: number | null = null;
  private rolling: TimedChunk[] = [];
  private active: TimedChunk[] = [];
  private state: 'idle' | 'armed' | 'recording' | 'finishing' = 'idle';
  private aboveSince = 0;
  private silenceSince = 0;
  private utteranceStartedAt = 0;
  private mutedUntil = 0;
  private lastWakeAt = 0;
  private lastRms = 0;
  private lastPeak = 0;

  constructor(options: Options = {}) {
    this.options = {
      threshold: options.threshold ?? numberEnv('EXPO_PUBLIC_AGA_VOLUME_WAKE_THRESHOLD', 0.026),
      silenceThreshold: options.silenceThreshold ?? numberEnv('EXPO_PUBLIC_AGA_VOLUME_WAKE_SILENCE_THRESHOLD', 0.014),
      holdMs: options.holdMs ?? numberEnv('EXPO_PUBLIC_AGA_VOLUME_WAKE_HOLD_MS', 160),
      silenceMs: options.silenceMs ?? numberEnv('EXPO_PUBLIC_AGA_VOLUME_WAKE_SILENCE_MS', 900),
      leadInMs: options.leadInMs ?? numberEnv('EXPO_PUBLIC_AGA_VOLUME_WAKE_LEAD_IN_MS', 900),
      maxUtteranceMs: options.maxUtteranceMs ?? numberEnv('EXPO_PUBLIC_AGA_VOLUME_WAKE_MAX_UTTERANCE_MS', 8500),
      refractoryMs: options.refractoryMs ?? numberEnv('EXPO_PUBLIC_AGA_VOLUME_WAKE_REFRACTORY_MS', 1800),
    };
  }

  async start(listener: BrowserApplianceListener) {
    if (this.state !== 'idle') return;
    const nav: any = globalThis.navigator;
    if (!nav?.mediaDevices?.getUserMedia) throw new Error('Browser microphone capture is unavailable.');

    this.listener = listener;
    this.stream = await nav.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });

    const AudioContextCtor = (globalThis as any).AudioContext || (globalThis as any).webkitAudioContext;
    this.audioContext = new AudioContextCtor();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.25;
    source.connect(this.analyser);

    this.mimeType = supportedMimeType();
    this.recorder = new MediaRecorder(this.stream, { mimeType: this.mimeType });
    this.recorder.ondataavailable = (event) => {
      if (!event.data?.size) return;
      const chunk = { at: Date.now(), blob: event.data };
      this.rolling.push(chunk);
      this.pruneRolling();
      if (this.state === 'recording' || this.state === 'finishing') this.active.push(chunk);
    };
    this.recorder.start(250);

    this.state = 'armed';
    listener({ type: 'status', mode: 'wake-listening', message: 'Volume-threshold wake layer armed.' });
    this.tick();
  }

  mute(ms: number) {
    this.mutedUntil = Math.max(this.mutedUntil, Date.now() + Math.max(0, ms));
  }

  async stop() {
    if (this.frame != null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.frame);
    this.frame = null;
    this.state = 'idle';
    try { this.recorder?.stop(); } catch {}
    this.recorder = null;
    this.stream?.getTracks?.().forEach((track) => track.stop());
    this.stream = null;
    await this.audioContext?.close?.().catch(() => undefined);
    this.audioContext = null;
    this.analyser = null;
    this.rolling = [];
    this.active = [];
    this.listener?.({ type: 'status', mode: 'idle', message: 'Volume-threshold wake layer stopped.' });
  }

  getDiagnostics() {
    return {
      provider: this.name,
      state: this.state,
      threshold: this.options.threshold,
      silenceThreshold: this.options.silenceThreshold,
      lastRms: this.lastRms,
      lastPeak: this.lastPeak,
      rollingChunks: this.rolling.length,
      recordingChunks: this.active.length,
      mutedMs: Math.max(0, this.mutedUntil - Date.now()),
    };
  }

  private pruneRolling() {
    const cutoff = Date.now() - Math.max(this.options.leadInMs, 1000) - 500;
    this.rolling = this.rolling.filter((chunk) => chunk.at >= cutoff);
  }

  private tick = () => {
    if (!this.analyser || this.state === 'idle') return;
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    const { rms, peak } = audioStats(data);
    this.lastRms = rms;
    this.lastPeak = peak;
    this.listener?.({ type: 'audio-level', rms, peak });

    const now = Date.now();
    if (shouldBlockUserCapture()) {
      this.aboveSince = 0;
      if (this.state === 'recording') void this.finishUtterance('assistant_output_started');
      this.listener?.({ type: 'status', mode: 'wake-listening', message: `Capture blocked while AGA is speaking (${Math.round(captureBlockedMs())}ms).` });
    } else if (now >= this.mutedUntil && this.state === 'armed') this.detectWake(now, rms);
    if (this.state === 'recording') void this.detectUtteranceEnd(now, rms);

    this.frame = requestAnimationFrame(this.tick);
  };

  private detectWake(now: number, rms: number) {
    if (now - this.lastWakeAt < this.options.refractoryMs) return;
    if (rms >= this.options.threshold) {
      if (!this.aboveSince) this.aboveSince = now;
      if (now - this.aboveSince >= this.options.holdMs) this.startUtterance(now, rms);
    } else {
      this.aboveSince = 0;
    }
  }

  private startUtterance(now: number, rms: number) {
    this.lastWakeAt = now;
    this.utteranceStartedAt = now;
    this.silenceSince = 0;
    const cutoff = now - this.options.leadInMs;
    this.active = this.rolling.filter((chunk) => chunk.at >= cutoff);
    this.state = 'recording';
    this.listener?.({ type: 'wake', provider: this.name, rms, confidence: Math.min(1, rms / Math.max(this.options.threshold, 0.001)) });
    this.listener?.({ type: 'status', mode: 'capturing', message: 'Speech detected; capturing user utterance. Mic will close before AGA speaks.' });
  }

  private async detectUtteranceEnd(now: number, rms: number) {
    if (now - this.utteranceStartedAt >= this.options.maxUtteranceMs) {
      await this.finishUtterance('max_duration');
      return;
    }
    if (rms <= this.options.silenceThreshold) {
      if (!this.silenceSince) this.silenceSince = now;
      if (now - this.silenceSince >= this.options.silenceMs) await this.finishUtterance('silence');
    } else {
      this.silenceSince = 0;
    }
  }

  private async finishUtterance(reason: string) {
    if (this.state !== 'recording') return;
    this.state = 'finishing';
    try { this.recorder?.requestData?.(); } catch {}
    await delay(120);
    const durationMs = Math.max(0, Date.now() - this.utteranceStartedAt);
    const chunks = this.active.map((chunk) => chunk.blob).filter(Boolean);
    this.active = [];
    this.aboveSince = 0;
    this.silenceSince = 0;
    this.state = 'armed';
    if (!chunks.length) return;
    const audio: ShortUtteranceAudio = {
      kind: 'web_blob',
      blob: new Blob(chunks, { type: this.mimeType }),
      mimeType: this.mimeType,
      durationMs,
    };
    this.listener?.({ type: 'utterance', provider: this.name, audio, durationMs, raw: { reason } });
  }
}
