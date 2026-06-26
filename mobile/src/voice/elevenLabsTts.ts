import { Platform } from 'react-native';
import { measureAsync, measureMark } from '../observability/measure';

declare function require(name: string): any;

export type ElevenLabsEmotion = 'neutral' | 'warm' | 'calm' | 'guided' | 'hypnosis' | 'conflict' | 'urgent';

export type ElevenLabsSpeakOptions = {
  voiceId?: string | null;
  modelId?: string | null;
  outputFormat?: string | null;
  emotion?: ElevenLabsEmotion;
  locale?: string | null;
  timeoutMs?: number;
  cacheKey?: string | null;
  onStart?: () => void;
  onDone?: () => void;
  onError?: (message: string) => void;
};

export type ElevenLabsDiagnostics = {
  available: boolean;
  speaking: boolean;
  starts: number;
  finishes: number;
  errors: number;
  lastError: string | null;
  lastVoiceId: string | null;
  lastModelId: string | null;
  lastChars: number;
  lastLatencyMs: number | null;
  lastFileUri: string | null;
  nativeStreaming: boolean;
  transport: 'websocket' | 'http-stream' | 'native';
};

type NativeChunkPlayer = {
  stop?: () => Promise<void> | void;
  playBase64Chunk?: (base64: string, meta?: Record<string, unknown>) => Promise<void> | void;
  finish?: () => Promise<void> | void;
};

let currentSound: any | null = null;
let speaking = false;
let cachedFileSystem: any | null | undefined;
let cachedAudio: any | null | undefined;
let cachedNativePlayer: NativeChunkPlayer | null | undefined;

const diagnostics: ElevenLabsDiagnostics = {
  available: false,
  speaking: false,
  starts: 0,
  finishes: 0,
  errors: 0,
  lastError: null,
  lastVoiceId: null,
  lastModelId: null,
  lastChars: 0,
  lastLatencyMs: null,
  lastFileUri: null,
  nativeStreaming: false,
  transport: 'http-stream',
};

function env(name: string) {
  return process.env?.[name] ?? '';
}

function apiKey() {
  return env('EXPO_PUBLIC_ELEVENLABS_API_KEY') || env('ELEVENLABS_API_KEY');
}

function defaultVoiceId() {
  return env('EXPO_PUBLIC_ELEVENLABS_VOICE_ID') || env('ELEVENLABS_VOICE_ID');
}

function defaultModelId() {
  return env('EXPO_PUBLIC_ELEVENLABS_MODEL_ID') || 'eleven_flash_v2_5';
}

function defaultOutputFormat() {
  return env('EXPO_PUBLIC_ELEVENLABS_OUTPUT_FORMAT') || 'mp3_44100_128';
}

function preferWebSocket() {
  return String(env('EXPO_PUBLIC_ELEVENLABS_TRANSPORT') || 'websocket').toLowerCase() !== 'http';
}

function numberEnv(name: string, fallback: number) {
  const n = Number(env(name));
  return Number.isFinite(n) ? n : fallback;
}

async function importFileSystem() {
  if (cachedFileSystem !== undefined) return cachedFileSystem;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedFileSystem = require('expo-file-system');
  } catch {
    cachedFileSystem = null;
  }
  return cachedFileSystem;
}

async function importAudio() {
  if (cachedAudio !== undefined) return cachedAudio;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedAudio = require('expo-av')?.Audio;
  } catch {
    cachedAudio = null;
  }
  return cachedAudio;
}

function nativeChunkPlayer(): NativeChunkPlayer | null {
  if (cachedNativePlayer !== undefined) return cachedNativePlayer;
  try {
    // Optional future native module for true PCM/MP3 chunk playback. If it is
    // absent, AGA still uses the streaming HTTP endpoint and plays the finished
    // file through expo-av.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('aga-native-audio-stream');
    cachedNativePlayer = mod?.default ?? mod ?? null;
  } catch {
    cachedNativePlayer = null;
  }
  diagnostics.nativeStreaming = Boolean(cachedNativePlayer?.playBase64Chunk);
  return cachedNativePlayer;
}

export function getElevenLabsDiagnostics() {
  return { ...diagnostics, speaking };
}

export function isElevenLabsConfigured() {
  return Boolean(apiKey() && defaultVoiceId());
}

export async function isElevenLabsAvailable() {
  if (!isElevenLabsConfigured()) return false;
  if (Platform.OS === 'web') return true;
  const fs = await importFileSystem();
  const audio = await importAudio();
  return Boolean(fs?.writeAsStringAsync && audio?.Sound?.createAsync);
}

function emotionText(text: string, emotion: ElevenLabsEmotion) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return clean;

  // Keep tags subtle. They help expressive models, while older models simply
  // read around them tolerably when the provider supports contextual emotion.
  if (emotion === 'hypnosis') return `[softly, slowly, reassuring] ${clean}`;
  if (emotion === 'guided') return `[calm, spacious, gentle] ${clean}`;
  if (emotion === 'conflict') return `[warm, grounded, steady] ${clean}`;
  if (emotion === 'urgent') return `[clear, focused] ${clean}`;
  if (emotion === 'calm') return `[calm] ${clean}`;
  if (emotion === 'warm') return `[warmly] ${clean}`;
  return clean;
}

function voiceSettingsFor(emotion: ElevenLabsEmotion) {
  const base = {
    stability: numberEnv('EXPO_PUBLIC_ELEVENLABS_STABILITY', 0.45),
    similarity_boost: numberEnv('EXPO_PUBLIC_ELEVENLABS_SIMILARITY_BOOST', 0.78),
    style: numberEnv('EXPO_PUBLIC_ELEVENLABS_STYLE', 0.18),
    use_speaker_boost: env('EXPO_PUBLIC_ELEVENLABS_USE_SPEAKER_BOOST') !== '0',
  };
  if (emotion === 'hypnosis') return { ...base, stability: Math.max(base.stability, 0.62), style: Math.max(base.style, 0.28) };
  if (emotion === 'guided') return { ...base, stability: Math.max(base.stability, 0.56), style: Math.max(base.style, 0.22) };
  if (emotion === 'conflict') return { ...base, stability: Math.max(base.stability, 0.58), style: Math.max(base.style, 0.2) };
  if (emotion === 'urgent') return { ...base, stability: Math.max(base.stability, 0.5), style: Math.min(base.style, 0.12) };
  return base;
}

function toBase64(bytes: Uint8Array) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += chars[a >> 2];
    out += chars[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += i + 1 < bytes.length ? chars[((b & 15) << 2) | ((c ?? 0) >> 6)] : '=';
    out += i + 2 < bytes.length ? chars[(c ?? 0) & 63] : '=';
  }
  return out;
}

async function playBase64Mp3(base64: string, cacheKey?: string | null) {
  const fs = await importFileSystem();
  const Audio = await importAudio();
  if (!fs?.writeAsStringAsync || !Audio?.Sound?.createAsync) {
    throw new Error('expo-file-system and expo-av are required for ElevenLabs native playback.');
  }
  const safeKey = String(cacheKey || `aga-tts-${Date.now()}`).replace(/[^a-z0-9._-]+/gi, '-').slice(0, 80);
  const dir = fs.cacheDirectory || fs.documentDirectory || '';
  if (!dir) throw new Error('No writable cache directory is available for ElevenLabs audio.');
  const uri = `${dir}${safeKey}.mp3`;
  await fs.writeAsStringAsync(uri, base64, { encoding: fs.EncodingType?.Base64 ?? 'base64' });
  diagnostics.lastFileUri = uri;

  await currentSound?.unloadAsync?.().catch?.(() => undefined);
  const created = await Audio.Sound.createAsync({ uri }, { shouldPlay: true, volume: 1.0 });
  currentSound = created?.sound ?? null;
  await new Promise<void>((resolve, reject) => {
    if (!currentSound?.setOnPlaybackStatusUpdate) {
      resolve();
      return;
    }
    currentSound.setOnPlaybackStatusUpdate((status: any) => {
      if (status?.didJustFinish) resolve();
      if (status?.error) reject(new Error(String(status.error)));
    });
  });
}


async function speakViaElevenLabsWebSocket(text: string, opts: ElevenLabsSpeakOptions) {
  const key = apiKey();
  const voiceId = opts.voiceId || defaultVoiceId();
  const modelId = opts.modelId || defaultModelId();
  const outputFormat = opts.outputFormat || defaultOutputFormat();
  if (!key) throw new Error('Missing EXPO_PUBLIC_ELEVENLABS_API_KEY.');
  if (!voiceId) throw new Error('Missing EXPO_PUBLIC_ELEVENLABS_VOICE_ID.');
  if (typeof WebSocket === 'undefined') return false;

  const native = nativeChunkPlayer();
  if (!native?.playBase64Chunk) return false;
  const started = Date.now();
  const url = `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream-input?model_id=${encodeURIComponent(modelId)}&output_format=${encodeURIComponent(outputFormat)}`;
  diagnostics.transport = 'native';

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => done(new Error('ElevenLabs WebSocket timed out.')), opts.timeoutMs ?? 22_000);
    const ws = new WebSocket(url);
    ws.onopen = () => {
      ws.send(JSON.stringify({
        text: ' ',
        xi_api_key: key,
        voice_settings: voiceSettingsFor(opts.emotion || 'neutral'),
        generation_config: { chunk_length_schedule: [80, 120, 180, 260] },
      }));
      ws.send(JSON.stringify({ text: emotionText(text, opts.emotion || 'neutral'), try_trigger_generation: true }));
      ws.send(JSON.stringify({ text: '' }));
    };
    ws.onmessage = async (event: any) => {
      try {
        const data = JSON.parse(String(event?.data ?? '{}'));
        if (data.audio) {
          await native.playBase64Chunk(String(data.audio), { outputFormat, voiceId, modelId });
        }
        if (data.isFinal) {
          clearTimeout(timer);
          try { ws.close(); } catch { /* ignore */ }
          done();
        }
      } catch (error) {
        clearTimeout(timer);
        try { ws.close(); } catch { /* ignore */ }
        done(error instanceof Error ? error : new Error(String(error ?? 'ElevenLabs WebSocket parse failed')));
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      done(new Error('ElevenLabs WebSocket connection failed.'));
    };
    ws.onclose = () => {
      clearTimeout(timer);
      if (!settled) done();
    };
  });

  if (native.finish) await native.finish();
  diagnostics.lastLatencyMs = Date.now() - started;
  return true;
}

async function fetchElevenLabsAudio(text: string, opts: ElevenLabsSpeakOptions) {
  if (preferWebSocket()) {
    try {
      const ok = await speakViaElevenLabsWebSocket(text, opts);
      if (ok) return;
    } catch (error) {
      measureMark('voice.tts.elevenlabs.websocket.fallback', { message: error instanceof Error ? error.message : String(error ?? 'websocket failed') });
    }
  }
  diagnostics.transport = 'http-stream';
  const key = apiKey();
  const voiceId = opts.voiceId || defaultVoiceId();
  const modelId = opts.modelId || defaultModelId();
  const outputFormat = opts.outputFormat || defaultOutputFormat();
  if (!key) throw new Error('Missing EXPO_PUBLIC_ELEVENLABS_API_KEY.');
  if (!voiceId) throw new Error('Missing EXPO_PUBLIC_ELEVENLABS_VOICE_ID.');

  const latency = env('EXPO_PUBLIC_ELEVENLABS_OPTIMIZE_STREAMING_LATENCY') || '3';
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=${encodeURIComponent(outputFormat)}&optimize_streaming_latency=${encodeURIComponent(latency)}`;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs ?? 18_000) : null;
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': key,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: emotionText(text, opts.emotion || 'neutral'),
        model_id: modelId,
        voice_settings: voiceSettingsFor(opts.emotion || 'neutral'),
      }),
      signal: controller?.signal,
    } as RequestInit);
    if (!response.ok) {
      const message = await response.text().catch(() => 'ElevenLabs request failed');
      throw new Error(`ElevenLabs TTS failed: ${message.slice(0, 240)}`);
    }

    // True incremental playback is delegated to an optional native chunk player.
    // React Native fetch implementations commonly expose arrayBuffer but not a
    // browser ReadableStream; this still uses ElevenLabs' low-latency stream API
    // and avoids expo-speech as the primary voice.
    const native = nativeChunkPlayer();
    if (native?.playBase64Chunk && response.body && typeof (response.body as any).getReader === 'function') {
      const reader = (response.body as any).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.length) await native.playBase64Chunk(toBase64(value), { outputFormat, voiceId, modelId });
      }
      await native.finish?.();
      diagnostics.lastLatencyMs = Date.now() - started;
      return;
    }

    const buffer = await response.arrayBuffer();
    diagnostics.lastLatencyMs = Date.now() - started;
    await playBase64Mp3(toBase64(new Uint8Array(buffer)), opts.cacheKey);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function stopElevenLabsSpeech() {
  speaking = false;
  diagnostics.speaking = false;
  try { await nativeChunkPlayer()?.stop?.(); } catch { /* optional native player */ }
  try { await currentSound?.stopAsync?.(); } catch { /* ignore */ }
  try { await currentSound?.unloadAsync?.(); } catch { /* ignore */ }
  currentSound = null;
}

export async function speakWithElevenLabs(text: string, opts: ElevenLabsSpeakOptions = {}) {
  return measureAsync('voice.tts.elevenlabs.speak', async () => {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) {
      opts.onDone?.();
      return false;
    }
    if (!(await isElevenLabsAvailable())) return false;

    await stopElevenLabsSpeech();
    diagnostics.available = true;
    diagnostics.speaking = true;
    diagnostics.starts += 1;
    diagnostics.lastError = null;
    diagnostics.lastChars = clean.length;
    diagnostics.lastVoiceId = opts.voiceId || defaultVoiceId() || null;
    diagnostics.lastModelId = opts.modelId || defaultModelId();
    speaking = true;
    opts.onStart?.();
    measureMark('voice.tts.elevenlabs.start', {
      chars: clean.length,
      model: diagnostics.lastModelId,
      voiceId: diagnostics.lastVoiceId,
      platform: Platform.OS,
      nativeStreaming: diagnostics.nativeStreaming,
    });

    try {
      await fetchElevenLabsAudio(clean, opts);
      diagnostics.finishes += 1;
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? 'ElevenLabs TTS failed');
      diagnostics.errors += 1;
      diagnostics.lastError = message;
      opts.onError?.(message);
      measureMark('voice.tts.elevenlabs.error', { message });
      return false;
    } finally {
      speaking = false;
      diagnostics.speaking = false;
      opts.onDone?.();
    }
  }, { chars: text.length, platform: Platform.OS });
}

export async function prefetchElevenLabsAudio(text: string, opts: ElevenLabsSpeakOptions = {}) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean || !(await isElevenLabsAvailable())) return null;
  const fs = await importFileSystem();
  if (!fs?.writeAsStringAsync) return null;
  const key = apiKey();
  const voiceId = opts.voiceId || defaultVoiceId();
  const modelId = opts.modelId || defaultModelId();
  const outputFormat = opts.outputFormat || defaultOutputFormat();
  if (!key || !voiceId) return null;
  const latency = env('EXPO_PUBLIC_ELEVENLABS_OPTIMIZE_STREAMING_LATENCY') || '3';
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=${encodeURIComponent(outputFormat)}&optimize_streaming_latency=${encodeURIComponent(latency)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text: emotionText(clean, opts.emotion || 'guided'), model_id: modelId, voice_settings: voiceSettingsFor(opts.emotion || 'guided') }),
  });
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  const safeKey = String(opts.cacheKey || `aga-prefetch-${Date.now()}`).replace(/[^a-z0-9._-]+/gi, '-').slice(0, 80);
  const uri = `${fs.cacheDirectory || fs.documentDirectory}${safeKey}.mp3`;
  await fs.writeAsStringAsync(uri, toBase64(bytes), { encoding: fs.EncodingType?.Base64 ?? 'base64' });
  return uri;
}
