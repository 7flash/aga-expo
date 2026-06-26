import { Platform } from 'react-native';
import { enterVoiceCommunicationMode, exitVoiceCommunicationMode } from './nativeAudioSession';

export type ShortUtteranceAudio =
  | { kind: 'web_blob'; blob: Blob; mimeType: string; durationMs: number }
  | { kind: 'native_uri'; uri: string; mimeType: string; durationMs: number }
  | { kind: 'base64'; base64: string; mimeType: string; durationMs: number };

export type ShortUtteranceRecorder = {
  start(): Promise<void>;
  stop(): Promise<ShortUtteranceAudio | null>;
  cancel(): Promise<void> | void;
  getDiagnostics?(): unknown;
};

function env(name: string) {
  return process.env?.[name] ?? '';
}

function numberEnv(name: string, fallback: number) {
  const n = Number(env(name));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function optionalImport(specifier: string): Promise<any | null> {
  try {
    return await (Function('s', 'return import(s)') as any)(specifier);
  } catch {
    return null;
  }
}

class WebShortUtteranceRecorder implements ShortUtteranceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private startedAt = 0;
  private mimeType = 'audio/webm';

  getDiagnostics() {
    return { provider: 'web-media-recorder', recording: !!this.recorder, mimeType: this.mimeType };
  }

  async start() {
    const nav: any = globalThis.navigator;
    if (!nav?.mediaDevices?.getUserMedia) throw new Error('Browser microphone capture is unavailable.');
    this.stream = await nav.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    this.mimeType = preferred.find((type) => (globalThis as any).MediaRecorder?.isTypeSupported?.(type)) || 'audio/webm';
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, { mimeType: this.mimeType });
    this.recorder.ondataavailable = (event) => {
      if (event.data?.size) this.chunks.push(event.data);
    };
    this.startedAt = Date.now();
    this.recorder.start(250);
  }

  async stop(): Promise<ShortUtteranceAudio | null> {
    const recorder = this.recorder;
    if (!recorder) return null;
    const durationMs = Math.max(0, Date.now() - this.startedAt);
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      try { recorder.stop(); } catch { resolve(); }
    });
    this.recorder = null;
    this.stream?.getTracks?.().forEach((track) => track.stop());
    this.stream = null;
    if (!this.chunks.length) return null;
    return { kind: 'web_blob', blob: new Blob(this.chunks, { type: this.mimeType }), mimeType: this.mimeType, durationMs };
  }

  async cancel() {
    try { this.recorder?.stop(); } catch { /* ignore */ }
    this.recorder = null;
    this.stream?.getTracks?.().forEach((track) => track.stop());
    this.stream = null;
    this.chunks = [];
  }
}

class NativeOptionalShortUtteranceRecorder implements ShortUtteranceRecorder {
  private recorder: any | null = null;
  private startedAt = 0;

  getDiagnostics() {
    return { provider: 'native-optional-short-recorder', recording: !!this.recorder };
  }

  async start() {
    await enterVoiceCommunicationMode({ reason: 'short_utterance_stt', speaker: false }).catch(() => undefined);
    // This intentionally avoids Android SpeechRecognizer. It is raw audio capture
    // only, used after wake so OpenAI STT can transcribe the short utterance.
    const mod = await optionalImport('react-native-audio-record') || await optionalImport('expo-av');
    if (mod?.default?.init || mod?.init) {
      const audioRecord = mod.default || mod;
      audioRecord.init?.({ sampleRate: 16000, channels: 1, bitsPerSample: 16, wavFile: 'aga-short-utterance.wav', audioSource: 7, audioSourceName: 'VOICE_COMMUNICATION' });
      audioRecord.start?.();
      this.recorder = { kind: 'audio-record', audioRecord };
      this.startedAt = Date.now();
      return;
    }
    if (mod?.Audio?.Recording) {
      const recording = new mod.Audio.Recording();
      await mod.Audio.setAudioModeAsync?.({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      await recording.prepareToRecordAsync(mod.Audio.RecordingOptionsPresets?.HIGH_QUALITY);
      await recording.startAsync();
      this.recorder = { kind: 'expo-av', recording };
      this.startedAt = Date.now();
      return;
    }
    throw new Error('No native raw-audio recorder is installed. Add react-native-audio-record or use expo-av recording for post-wake STT capture.');
  }

  async stop(): Promise<ShortUtteranceAudio | null> {
    if (!this.recorder) return null;
    const durationMs = Math.max(0, Date.now() - this.startedAt);
    const current = this.recorder;
    this.recorder = null;
    if (current.kind === 'audio-record') {
      const uri = await current.audioRecord.stop?.();
      await exitVoiceCommunicationMode().catch(() => undefined);
      return uri ? { kind: 'native_uri', uri: String(uri), mimeType: 'audio/wav', durationMs } : null;
    }
    await current.recording.stopAndUnloadAsync();
    const uri = current.recording.getURI?.();
    await exitVoiceCommunicationMode().catch(() => undefined);
    return uri ? { kind: 'native_uri', uri: String(uri), mimeType: 'audio/m4a', durationMs } : null;
  }

  async cancel() {
    try {
      if (this.recorder?.kind === 'audio-record') await this.recorder.audioRecord.stop?.();
      if (this.recorder?.kind === 'expo-av') await this.recorder.recording.stopAndUnloadAsync?.();
    } catch { /* ignore */ }
    this.recorder = null;
    if (Platform.OS !== 'web') await exitVoiceCommunicationMode().catch(() => undefined);
  }
}

export function createShortUtteranceRecorder(): ShortUtteranceRecorder {
  if (Platform.OS === 'web') return new WebShortUtteranceRecorder();
  return new NativeOptionalShortUtteranceRecorder();
}

export function shortUtteranceCaptureMs() {
  return numberEnv('EXPO_PUBLIC_AGA_SHORT_UTTERANCE_CAPTURE_MS', 6500);
}
