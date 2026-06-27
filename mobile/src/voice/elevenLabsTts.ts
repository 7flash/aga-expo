import { Platform } from 'react-native';
import { measureAsync, measureMark } from '../observability/measure';
import { fetchTtsGatewayAudio, getTtsGatewayDiagnostics, isTtsGatewayConfigured } from './ttsGateway';
import { getCachedVoiceUri, pruneVoiceCache, voiceCacheUri, writeVoiceCacheBase64, type VoiceCacheKey } from './voiceCache';

declare function require(name: string): any;
declare const __DEV__: boolean;

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
  transport: 'gateway' | 'direct-http' | 'native' | 'cache' | 'unavailable';
  gateway: ReturnType<typeof getTtsGatewayDiagnostics>;
};

type AudioModule = {
  Sound?: {
    createAsync?: (source: { uri: string }, initialStatus?: Record<string, unknown>) => Promise<{ sound: any }>;
  };
};

type NativeChunkPlayer = {
  stop?: () => Promise<void> | void;
  playBase64Chunk?: (base64: string, meta?: Record<string, unknown>) => Promise<void> | void;
  finish?: () => Promise<void> | void;
};

let currentSound: any | null = null;
let speaking = false;
let cachedAudio: AudioModule | null | undefined;
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
  transport: 'unavailable',
  gateway: getTtsGatewayDiagnostics(),
};

function env(name: string) {
  return process.env?.[name] ?? '';
}

function directApiKey() {
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

function allowDirectElevenLabs() {
  return String(env('EXPO_PUBLIC_AGA_ALLOW_DIRECT_ELEVENLABS') || (__DEV__ ? '1' : '0')) !== '0';
}

function numberEnv(name: string, fallback: number) {
  const n = Number(env(name));
  return Number.isFinite(n) ? n : fallback;
}

async function importAudio() {
  if (cachedAudio !== undefined) return cachedAudio;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedAudio = require('expo-av')?.Audio ?? null;
  } catch {
    cachedAudio = null;
  }
  return cachedAudio;
}

function nativeChunkPlayer(): NativeChunkPlayer | null {
  if (cachedNativePlayer !== undefined) return cachedNativePlayer;
  try {
    // Optional native player. Gateway/direct HTTP still works without it.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('aga-native-audio-stream');
    cachedNativePlayer = mod?.default ?? mod ?? null;
  } catch {
    cachedNativePlayer = null;
  }
  diagnostics.nativeStreaming = Boolean(cachedNativePlayer?.playBase64Chunk);
  return cachedNativePlayer;
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

function emotionText(text: string, emotion: ElevenLabsEmotion) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return clean;
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

function cacheKeyFor(text: string, opts: ElevenLabsSpeakOptions): VoiceCacheKey {
  return {
    text,
    voiceId: opts.voiceId || defaultVoiceId() || 'gateway-default',
    modelId: opts.modelId || defaultModelId(),
    emotion: opts.emotion || 'neutral',
    outputFormat: opts.outputFormat || defaultOutputFormat(),
  };
}

async function playUri(uri: string) {
  const Audio = await importAudio();
  if (!Audio?.Sound?.createAsync) throw new Error('expo-av is required for expressive TTS playback.');
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

async function playBytes(buffer: ArrayBuffer, key: VoiceCacheKey) {
  const native = nativeChunkPlayer();
  const base64 = toBase64(new Uint8Array(buffer));
  if (native?.playBase64Chunk) {
    diagnostics.transport = 'native';
    await native.playBase64Chunk(base64, { outputFormat: key.outputFormat, voiceId: key.voiceId, modelId: key.modelId });
    await native.finish?.();
    return;
  }
  const uri = await writeVoiceCacheBase64(key, base64);
  if (!uri) throw new Error('Could not write voice cache for playback.');
  diagnostics.lastFileUri = uri;
  await playUri(uri);
}

async function fetchDirectElevenLabs(text: string, opts: ElevenLabsSpeakOptions) {
  const key = directApiKey();
  const voiceId = opts.voiceId || defaultVoiceId();
  const modelId = opts.modelId || defaultModelId();
  const outputFormat = opts.outputFormat || defaultOutputFormat();
  if (!allowDirectElevenLabs()) throw new Error('Direct ElevenLabs calls are disabled. Configure EXPO_PUBLIC_AGA_TTS_GATEWAY_URL.');
  if (!key) throw new Error('Missing ElevenLabs API key.');
  if (!voiceId) throw new Error('Missing ElevenLabs voice id.');

  const latency = env('EXPO_PUBLIC_ELEVENLABS_OPTIMIZE_STREAMING_LATENCY') || '3';
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=${encodeURIComponent(outputFormat)}&optimize_streaming_latency=${encodeURIComponent(latency)}`;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), opts.timeoutMs ?? 18_000) : null;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({ text: emotionText(text, opts.emotion || 'neutral'), model_id: modelId, voice_settings: voiceSettingsFor(opts.emotion || 'neutral') }),
      signal: controller?.signal,
    } as RequestInit);
    if (!response.ok) {
      const message = await response.text().catch(() => 'ElevenLabs direct request failed');
      throw new Error(`ElevenLabs direct TTS failed: ${message.slice(0, 240)}`);
    }
    diagnostics.transport = 'direct-http';
    return response.arrayBuffer();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function synthesizeAudio(text: string, opts: ElevenLabsSpeakOptions) {
  const voiceId = opts.voiceId || defaultVoiceId();
  const modelId = opts.modelId || defaultModelId();
  const outputFormat = opts.outputFormat || defaultOutputFormat();
  const emotion = opts.emotion || 'neutral';
  const key = cacheKeyFor(text, opts);
  const cached = await getCachedVoiceUri(key);
  if (cached) {
    diagnostics.transport = 'cache';
    diagnostics.lastFileUri = cached;
    return { uri: cached, buffer: null as ArrayBuffer | null, cacheKey: key };
  }

  if (isTtsGatewayConfigured()) {
    diagnostics.transport = 'gateway';
    const buffer = await fetchTtsGatewayAudio({ text, voiceId, modelId, outputFormat, emotion, voiceSettings: voiceSettingsFor(emotion), timeoutMs: opts.timeoutMs });
    return { uri: null, buffer, cacheKey: key };
  }

  const buffer = await fetchDirectElevenLabs(text, opts);
  return { uri: null, buffer, cacheKey: key };
}

export function getElevenLabsDiagnostics() {
  diagnostics.gateway = getTtsGatewayDiagnostics();
  return { ...diagnostics, speaking };
}

export function isElevenLabsConfigured() {
  return Boolean((isTtsGatewayConfigured() || (allowDirectElevenLabs() && directApiKey())) && (defaultVoiceId() || isTtsGatewayConfigured()));
}

export async function isElevenLabsAvailable() {
  if (!isElevenLabsConfigured()) return false;
  if (Platform.OS === 'web') return true;
  const Audio = await importAudio();
  return Boolean(Audio?.Sound?.createAsync);
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
    const started = Date.now();
    diagnostics.available = true;
    diagnostics.speaking = true;
    diagnostics.starts += 1;
    diagnostics.lastError = null;
    diagnostics.lastChars = clean.length;
    diagnostics.lastVoiceId = opts.voiceId || defaultVoiceId() || (isTtsGatewayConfigured() ? 'gateway-default' : null);
    diagnostics.lastModelId = opts.modelId || defaultModelId();
    speaking = true;
    opts.onStart?.();
    measureMark('voice.tts.elevenlabs.start', { chars: clean.length, model: diagnostics.lastModelId, voiceId: diagnostics.lastVoiceId, platform: Platform.OS });

    try {
      const result = await synthesizeAudio(clean, opts);
      if (result.uri) await playUri(result.uri);
      else if (result.buffer) await playBytes(result.buffer, result.cacheKey);
      diagnostics.finishes += 1;
      diagnostics.lastLatencyMs = Date.now() - started;
      pruneVoiceCache().catch(() => undefined);
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
  const key = cacheKeyFor(clean, { ...opts, emotion: opts.emotion || 'guided' });
  const cached = await getCachedVoiceUri(key);
  if (cached) return cached;
  try {
    const result = await synthesizeAudio(clean, { ...opts, emotion: opts.emotion || 'guided' });
    if (result.uri) return result.uri;
    if (!result.buffer) return null;
    const uri = await voiceCacheUri(key);
    if (!uri) return null;
    await writeVoiceCacheBase64(key, toBase64(new Uint8Array(result.buffer)));
    return uri;
  } catch (error) {
    measureMark('voice.tts.elevenlabs.prefetch.error', { message: error instanceof Error ? error.message : String(error ?? 'prefetch failed') });
    return null;
  }
}