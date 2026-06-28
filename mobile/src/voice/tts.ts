import { Platform } from 'react-native';
import { measureAsync, measureMark } from '../observability/measure';
import { speakWithElevenLabs as speakWithCachedElevenLabs, stopElevenLabsSpeech } from './elevenLabsTts';
import { speakWithBrowserAudioTts, browserAudioTtsAvailable, stopBrowserAudioTts } from './browserAudioTts';


declare function require(name: string): any;

type TtsProvider = 'elevenlabs' | 'openai' | 'expo-speech' | 'web-speech' | 'none' | 'auto';

export type TtsEmotion = 'warm' | 'calm' | 'guided' | 'hypnosis' | 'conflict' | 'urgent' | 'neutral';

export type SpeakOptions = {
  provider?: TtsProvider;
  emotion?: TtsEmotion;
  interrupt?: boolean;
  cacheKey?: string;
  onStart?: () => void;
  onDone?: () => void;
  onError?: (message: string) => void;
};

function env(name: string) {
  return process.env?.[name] ?? '';
}

function providerPreference(): TtsProvider {
  const raw = String(env('EXPO_PUBLIC_AGA_TTS_PROVIDER') || 'elevenlabs').toLowerCase() as TtsProvider;
  return raw || 'elevenlabs';
}

function voiceIdForEmotion(emotion: TtsEmotion) {
  const key = `EXPO_PUBLIC_ELEVENLABS_VOICE_${emotion.toUpperCase()}`;
  return env(key) || env('EXPO_PUBLIC_ELEVENLABS_VOICE_ID');
}

function openAiVoiceForEmotion(emotion: TtsEmotion) {
  const key = `EXPO_PUBLIC_OPENAI_TTS_VOICE_${emotion.toUpperCase()}`;
  return env(key) || env('EXPO_PUBLIC_OPENAI_TTS_VOICE') || 'shimmer';
}

function elevenModelForEmotion(emotion: TtsEmotion) {
  if (emotion === 'hypnosis' || emotion === 'guided') return env('EXPO_PUBLIC_ELEVENLABS_GUIDED_MODEL') || env('EXPO_PUBLIC_ELEVENLABS_MODEL') || 'eleven_flash_v2_5';
  return env('EXPO_PUBLIC_ELEVENLABS_MODEL') || 'eleven_flash_v2_5';
}

function stabilityForEmotion(emotion: TtsEmotion) {
  if (emotion === 'hypnosis') return 0.72;
  if (emotion === 'urgent') return 0.44;
  if (emotion === 'conflict') return 0.62;
  return 0.56;
}

function browserProviderFor(candidate: TtsProvider): 'elevenlabs' | 'openai' | null {
  if (Platform.OS !== 'web') return null;
  if (candidate === 'elevenlabs') return 'elevenlabs';
  if (candidate === 'openai') return 'openai';
  if (candidate === 'auto') {
    if (browserAudioTtsAvailable('elevenlabs')) return 'elevenlabs';
    if (browserAudioTtsAvailable('openai')) return 'openai';
  }
  return null;
}

async function speakWithBrowserProvider(text: string, candidate: TtsProvider, opts: SpeakOptions) {
  const browserProvider = browserProviderFor(candidate);
  if (!browserProvider || !browserAudioTtsAvailable(browserProvider)) return false;
  await speakWithBrowserAudioTts(text, {
    provider: browserProvider,
    emotion: opts.emotion,
    voiceId: browserProvider === 'elevenlabs' ? voiceIdForEmotion(opts.emotion || 'warm') : openAiVoiceForEmotion(opts.emotion || 'warm'),
  });
  return true;
}

async function playBase64Mp3(base64: string) {
  const req = (0, eval)('typeof require !== "undefined" ? require : null');
  const FileSystem = req?.('expo-file-system');
  const AV = req?.('expo-av');
  if (!FileSystem?.writeAsStringAsync || !AV?.Audio?.Sound) throw new Error('expo-av and expo-file-system are required for native TTS playback.');
  const uri = `${FileSystem.cacheDirectory || FileSystem.documentDirectory}aga-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  const sound = new AV.Audio.Sound();
  await sound.loadAsync({ uri }, { shouldPlay: true, volume: 1.0 });
  await new Promise<void>((resolve) => {
    sound.setOnPlaybackStatusUpdate((status: any) => {
      if (!status?.isLoaded || status.didJustFinish) resolve();
    });
  });
  await sound.unloadAsync().catch(() => undefined);
}

async function responseArrayBufferToBase64(response: Response) {
  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) binary += String.fromCharCode(bytes[i]);
  const root: any = globalThis as any;
  if (root.btoa) return root.btoa(binary);
  const BufferCtor = (0, eval)('typeof Buffer !== "undefined" ? Buffer : null');
  if (BufferCtor) return BufferCtor.from(bytes).toString('base64');
  throw new Error('No base64 encoder available for TTS audio.');
}

export async function stopTts() {
  stopBrowserAudioTts();
  await stopElevenLabsSpeech().catch(() => undefined);
  const root: any = globalThis as any;
  try { root?.speechSynthesis?.cancel?.(); } catch { /* ignore */ }
  try {
    const req = (0, eval)('typeof require !== "undefined" ? require : null');
    const Speech = req?.('expo-speech');
    await Speech?.stop?.();
  } catch { /* ignore */ }
}

async function speakWithDirectElevenLabs(text: string, opts: SpeakOptions) {
  const apiKey = env('EXPO_PUBLIC_ELEVENLABS_API_KEY') || env('ELEVENLABS_API_KEY');
  const voiceId = voiceIdForEmotion(opts.emotion || 'warm');
  if (!apiKey) throw new Error('Missing EXPO_PUBLIC_ELEVENLABS_API_KEY.');
  if (!voiceId) throw new Error('Missing EXPO_PUBLIC_ELEVENLABS_VOICE_ID.');

  const outputFormat = env('EXPO_PUBLIC_ELEVENLABS_OUTPUT_FORMAT') || 'mp3_44100_128';
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=${encodeURIComponent(outputFormat)}`;
  const emotion = opts.emotion || 'warm';
  const body = {
    text,
    model_id: elevenModelForEmotion(emotion),
    voice_settings: {
      stability: stabilityForEmotion(emotion),
      similarity_boost: 0.82,
      style: emotion === 'hypnosis' ? 0.18 : emotion === 'urgent' ? 0.35 : 0.24,
      use_speaker_boost: true,
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'content-type': 'application/json',
      accept: 'audio/mpeg',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS failed: ${res.status}`);
  const base64 = await responseArrayBufferToBase64(res);
  await playBase64Mp3(base64);
}

async function speakWithOpenAiTts(text: string, opts: SpeakOptions) {
  const apiKey = env('EXPO_PUBLIC_OPENAI_API_KEY') || env('OPENAI_API_KEY');
  if (!apiKey) throw new Error('Missing EXPO_PUBLIC_OPENAI_API_KEY.');
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: env('EXPO_PUBLIC_OPENAI_TTS_MODEL') || 'gpt-4o-mini-tts',
      voice: openAiVoiceForEmotion(opts.emotion || 'warm'),
      input: text,
      response_format: 'mp3',
    }),
  });
  if (!res.ok) throw new Error(`OpenAI TTS failed: ${res.status}`);
  const base64 = await responseArrayBufferToBase64(res);
  await playBase64Mp3(base64);
}

async function speakWithWebSpeech(text: string, opts: SpeakOptions) {
  const root: any = globalThis as any;
  if (!root?.speechSynthesis || !root?.SpeechSynthesisUtterance) throw new Error('Web Speech is unavailable.');
  await stopTts();
  await new Promise<void>((resolve) => {
    const utterance = new root.SpeechSynthesisUtterance(text);
    utterance.rate = opts.emotion === 'hypnosis' ? 0.72 : 0.9;
    utterance.pitch = opts.emotion === 'urgent' ? 1.1 : 0.98;
    utterance.volume = 1;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    root.speechSynthesis.speak(utterance);
  });
}

async function speakWithExpoSpeech(text: string, opts: SpeakOptions) {
  const req = (0, eval)('typeof require !== "undefined" ? require : null');
  const Speech = req?.('expo-speech');
  if (!Speech?.speak) throw new Error('expo-speech is unavailable.');
  await stopTts();
  await new Promise<void>((resolve) => Speech.speak(text, {
    language: env('EXPO_PUBLIC_AGA_SPEAK_LOCALE') || 'en-US',
    rate: opts.emotion === 'hypnosis' ? 0.72 : 0.88,
    pitch: opts.emotion === 'urgent' ? 1.08 : 1.0,
    onDone: resolve,
    onStopped: resolve,
    onError: resolve,
  }));
}

export async function speakText(text: string, opts: SpeakOptions = {}) {
  const clean = String(text || '').trim();
  if (!clean) return;
  const provider = opts.provider || providerPreference();
  return measureAsync('voice.tts.speak', async () => {
    if (opts.interrupt !== false) await stopTts();
    opts.onStart?.();
    const order: TtsProvider[] = provider === 'auto'
      ? ['elevenlabs', 'openai', Platform.OS === 'web' ? 'web-speech' : 'expo-speech']
      : [provider, provider === 'elevenlabs' ? 'openai' : 'elevenlabs', Platform.OS === 'web' ? 'web-speech' : 'expo-speech'];

    let lastError = '';
    for (const candidate of order) {
      try {
        if (await speakWithBrowserProvider(clean, candidate, opts)) {
          // Browser preview must play API audio through an HTMLAudioElement.
          // The native expo-av/file-system path is intentionally skipped on web.
        }
        else if (candidate === 'elevenlabs') {
          const ok = await speakWithCachedElevenLabs(clean, { emotion: opts.emotion || 'warm', cacheKey: opts.cacheKey, onError: opts.onError });
          if (!ok) await speakWithDirectElevenLabs(clean, opts);
        }
        else if (candidate === 'openai') await speakWithOpenAiTts(clean, opts);
        else if (candidate === 'web-speech') await speakWithWebSpeech(clean, opts);
        else if (candidate === 'expo-speech') await speakWithExpoSpeech(clean, opts);
        else continue;
        opts.onDone?.();
        measureMark('voice.tts.done', { provider: candidate, emotion: opts.emotion || 'warm' });
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error || candidate);
        measureMark('voice.tts.provider_failed', { provider: candidate, error: lastError });
      }
    }
    opts.onError?.(lastError || 'No TTS provider available.');
    throw new Error(lastError || 'No TTS provider available.');
  }, { provider, emotion: opts.emotion || 'warm' });
}

// Backwards compatible names used by older code.
export const speak = speakText;
export const stopSpeaking = stopTts;