import { measureAsync } from '../observability/measure';
import { markSpeaking, markTtsDone, muteWakeFor, noteReply } from './browserVoiceActivityState';

export type BrowserAudioTtsProvider = 'elevenlabs' | 'openai';

export type BrowserAudioTtsOptions = {
  provider?: BrowserAudioTtsProvider;
  voiceId?: string;
  modelId?: string;
  emotion?: string;
};

function env(name: string, fallback = '') {
  return String((process as any)?.env?.[name] || fallback).trim();
}

function isWeb() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function clean(text: string) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function estimatedPlaybackMs(text: string) {
  const chars = clean(text).length;
  // Browser blob audio can lose the `ended` event in Expo web/Hermes preview.
  // Use a voice-length estimate as the safety timer instead of a fixed 60s,
  // otherwise a one-sentence answer keeps AGA in SPEAKING for a full minute.
  return Math.max(1400, Math.min(22000, Math.round(900 + chars * 58)));
}

function playbackTimeoutMs(audio: HTMLAudioElement, spokenText: string) {
  const duration = Number(audio.duration);
  if (Number.isFinite(duration) && duration > 0) {
    return Math.max(1200, Math.min(30000, Math.round(duration * 1000 + 1200)));
  }
  return estimatedPlaybackMs(spokenText) + 1600;
}

let activeAudio: HTMLAudioElement | null = null;
let activeUrl = '';

export function stopBrowserAudioTts() {
  try {
    activeAudio?.pause();
    activeAudio?.removeAttribute('src');
    activeAudio?.load();
  } catch {}

  if (activeUrl) {
    try { URL.revokeObjectURL(activeUrl); } catch {}
  }

  activeAudio = null;
  activeUrl = '';

  if (typeof window !== 'undefined') {
    (window as any).__AGA_TTS_ACTIVE = false;
  }
}

async function playBlob(blob: Blob, spokenText: string) {
  if (!isWeb()) throw new Error('Browser audio TTS can only run on web.');

  stopBrowserAudioTts();

  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);

  activeUrl = url;
  activeAudio = audio;

  audio.preload = 'auto';

  if (typeof window !== 'undefined') {
    (window as any).__AGA_TTS_ACTIVE = true;
  }

  const estimatedMs = estimatedPlaybackMs(spokenText);

  noteReply(spokenText);
  markSpeaking('tts playback', estimatedMs + 2200);
  muteWakeFor(estimatedMs + 2800, 'mute wake during TTS');

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let started = false;
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;

    const clearSafetyTimer = () => {
      if (safetyTimer) clearTimeout(safetyTimer);
      safetyTimer = null;
    };

    const armSafetyTimer = () => {
      clearSafetyTimer();
      safetyTimer = setTimeout(done, playbackTimeoutMs(audio, spokenText));
    };

    const cleanup = () => {
      clearSafetyTimer();
      audio.onended = null;
      audio.onerror = null;
      audio.oncanplaythrough = null;
      audio.onloadedmetadata = null;
      audio.ontimeupdate = null;
      audio.onpause = null;
    };

    const done = () => {
      if (settled) return;
      settled = true;
      cleanup();

      if (activeUrl === url) {
        try { URL.revokeObjectURL(url); } catch {}
        activeUrl = '';
        activeAudio = null;
      }

      if (typeof window !== 'undefined') {
        (window as any).__AGA_TTS_ACTIVE = false;
      }

      // Keep wake muted briefly so the microphone does not catch the tail of
      // speaker output and immediately start another command.
      muteWakeFor(1800, 'post TTS tail mute');
      markTtsDone('browser audio tts done');
      resolve();
    };

    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();

      if (typeof window !== 'undefined') {
        (window as any).__AGA_TTS_ACTIVE = false;
      }

      muteWakeFor(1200, 'tts failed tail mute');
      markTtsDone('browser audio tts failed');
      reject(new Error('Browser audio playback failed.'));
    };

    audio.onended = done;
    audio.onerror = fail;
    audio.onloadedmetadata = armSafetyTimer;
    audio.ontimeupdate = () => {
      const duration = Number(audio.duration);
      if (Number.isFinite(duration) && duration > 0 && audio.currentTime >= duration - 0.05) done();
    };
    audio.onpause = () => {
      if (audio.currentTime > 0 && audio.ended) done();
    };

    const start = () => {
      if (started || settled) return;
      started = true;
      armSafetyTimer();
      audio.play().then(armSafetyTimer).catch(fail);
    };

    audio.oncanplaythrough = start;

    // Some browsers never fire canplaythrough reliably for blob MP3.
    setTimeout(start, 120);
  });
}

async function elevenLabsBlob(text: string, options: BrowserAudioTtsOptions = {}) {
  const apiKey = env('EXPO_PUBLIC_ELEVENLABS_API_KEY');
  const voiceId = options.voiceId || env('EXPO_PUBLIC_ELEVENLABS_VOICE_ID');

  if (!apiKey) throw new Error('Missing EXPO_PUBLIC_ELEVENLABS_API_KEY.');
  if (!voiceId) throw new Error('Missing EXPO_PUBLIC_ELEVENLABS_VOICE_ID.');

  const modelId = options.modelId || env('EXPO_PUBLIC_ELEVENLABS_MODEL_ID', 'eleven_multilingual_v2');
  const outputFormat = env('EXPO_PUBLIC_ELEVENLABS_OUTPUT_FORMAT', 'mp3_44100_128');
  const optimize = env('EXPO_PUBLIC_ELEVENLABS_OPTIMIZE_STREAMING_LATENCY', '3');

  const stability = Number(env('EXPO_PUBLIC_ELEVENLABS_STABILITY', '0.45'));
  const similarityBoost = Number(env('EXPO_PUBLIC_ELEVENLABS_SIMILARITY_BOOST', '0.75'));
  const style = Number(env('EXPO_PUBLIC_ELEVENLABS_STYLE', '0.35'));
  const useSpeakerBoost = env('EXPO_PUBLIC_ELEVENLABS_USE_SPEAKER_BOOST', '1') !== '0';

  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}` +
    `/stream?optimize_streaming_latency=${encodeURIComponent(optimize)}` +
    `&output_format=${encodeURIComponent(outputFormat)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'audio/mpeg',
      'content-type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability,
        similarity_boost: similarityBoost,
        style,
        use_speaker_boost: useSpeakerBoost,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`ElevenLabs TTS HTTP ${response.status}${body ? `: ${body.slice(0, 240)}` : ''}`);
  }

  return response.blob();
}

async function openAiBlob(text: string, options: BrowserAudioTtsOptions = {}) {
  const apiKey = env('EXPO_PUBLIC_OPENAI_API_KEY');
  if (!apiKey) throw new Error('Missing EXPO_PUBLIC_OPENAI_API_KEY.');

  const model = options.modelId || env('EXPO_PUBLIC_OPENAI_TTS_MODEL', 'gpt-4o-mini-tts');
  const voice = options.voiceId || env('EXPO_PUBLIC_OPENAI_TTS_VOICE', 'alloy');

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      voice,
      input: text,
      format: 'mp3',
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenAI TTS HTTP ${response.status}${body ? `: ${body.slice(0, 240)}` : ''}`);
  }

  return response.blob();
}

export function preferredBrowserAudioTtsProvider(): BrowserAudioTtsProvider {
  const requested =
    env('EXPO_PUBLIC_AGA_SHORT_TTS_PROVIDER') ||
    env('EXPO_PUBLIC_AGA_TTS_PROVIDER') ||
    env('EXPO_PUBLIC_AGA_BROWSER_TTS_PROVIDER');

  if (/openai/i.test(requested)) return 'openai';
  return 'elevenlabs';
}

export function browserAudioTtsAvailable(provider?: BrowserAudioTtsProvider) {
  if (!isWeb()) return false;

  const p = provider || preferredBrowserAudioTtsProvider();

  if (p === 'elevenlabs') {
    return !!env('EXPO_PUBLIC_ELEVENLABS_API_KEY') && !!env('EXPO_PUBLIC_ELEVENLABS_VOICE_ID');
  }

  if (p === 'openai') {
    return !!env('EXPO_PUBLIC_OPENAI_API_KEY');
  }

  return false;
}

export async function speakWithBrowserAudioTts(textInput: string, options: BrowserAudioTtsOptions = {}) {
  const text = clean(textInput);
  if (!text) return;

  if (!isWeb()) throw new Error('Browser audio TTS is only available on web.');

  const provider = options.provider || preferredBrowserAudioTtsProvider();

  return measureAsync('voice.tts.browser_audio', async () => {
    const blob = provider === 'openai'
      ? await openAiBlob(text, options)
      : await elevenLabsBlob(text, options);

    await playBlob(blob, text);

    return { provider, bytes: blob.size };
  }, { provider });
}