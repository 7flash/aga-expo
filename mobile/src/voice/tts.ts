import { Platform } from 'react-native';
import { getPersona } from '../aga/personas';
import type { Preferences } from '../db/localStore';
import { measureAsync, measureMark } from '../observability/measure';
import {
  getElevenLabsDiagnostics,
  isElevenLabsAvailable,
  speakWithElevenLabs,
  stopElevenLabsSpeech,
  type ElevenLabsEmotion,
} from './elevenLabsTts';

declare function require(name: string): any;

type TtsProvider = 'elevenlabs' | 'expo-speech' | 'web-speech' | 'openai-tts' | 'none';

type TtsCallbacks = {
  onStart?: () => void;
  onDone?: () => void;
  onError?: (message: string) => void;
};

type TtsDiagnostics = {
  provider: TtsProvider;
  available: boolean;
  unlocked: boolean;
  speaking: boolean;
  starts: number;
  finishes: number;
  errors: number;
  lastError: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastTextChars: number;
  lastVoiceName: string | null;
  voiceCount: number;
  elevenLabs?: ReturnType<typeof getElevenLabsDiagnostics>;
};

let speaking = false;
let currentUtterance: any | null = null;
let currentAudio: any | null = null;
let cachedSpeech: any | null | undefined;

const diagnostics: TtsDiagnostics = {
  provider: 'none',
  available: false,
  unlocked: false,
  speaking: false,
  starts: 0,
  finishes: 0,
  errors: 0,
  lastError: null,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastTextChars: 0,
  lastVoiceName: null,
  voiceCount: 0,
};

async function importSpeech() {
  if (cachedSpeech !== undefined) return cachedSpeech;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedSpeech = require('expo-speech');
  } catch {
    cachedSpeech = null;
  }
  return cachedSpeech;
}

function getWebSpeech() {
  if (Platform.OS !== 'web') return null;
  const root: any = globalThis as any;
  const synth = root.speechSynthesis;
  const Utterance = root.SpeechSynthesisUtterance;
  if (!synth || !Utterance) return null;
  return { synth, Utterance };
}

function finish(callbacks?: TtsCallbacks, error?: string) {
  speaking = false;
  diagnostics.speaking = false;
  diagnostics.lastFinishedAt = new Date().toISOString();
  diagnostics.finishes += 1;
  if (error) {
    diagnostics.errors += 1;
    diagnostics.lastError = error;
    callbacks?.onError?.(error);
    measureMark('voice.tts.error', { message: error });
  }
  callbacks?.onDone?.();
}

function env(name: string) {
  return process.env?.[name] ?? '';
}

function openAiApiKey() {
  return env('EXPO_PUBLIC_OPENAI_API_KEY') || env('OPENAI_API_KEY');
}

function preferProvider() {
  return String(env('EXPO_PUBLIC_AGA_TTS_PROVIDER') || 'elevenlabs').toLowerCase();
}

function allowExpoFallback() {
  return String(env('EXPO_PUBLIC_AGA_ALLOW_EXPO_SPEECH_FALLBACK') || '1') !== '0';
}

function preferOpenAiTts() {
  const provider = preferProvider();
  return Platform.OS === 'web' && (provider === 'openai' || provider === 'openai-tts') && Boolean(openAiApiKey());
}

function voiceScore(voice: any, wantedLocale: string) {
  const name = String(voice?.name ?? '').toLowerCase();
  const lang = String(voice?.lang ?? '').toLowerCase();
  const wanted = wantedLocale.toLowerCase();
  let score = 0;
  if (lang === wanted) score += 10;
  if (lang.startsWith(wanted.split('-')[0])) score += 5;
  if (/natural|neural|enhanced|premium|google|microsoft|samantha|daniel|ava|aria/.test(name)) score += 2;
  if (/compact|default/.test(name)) score -= 1;
  return score;
}

function chooseWebVoice(locale: string) {
  const web = getWebSpeech();
  if (!web?.synth?.getVoices) return null;
  const voices: any[] = web.synth.getVoices?.() ?? [];
  diagnostics.voiceCount = voices.length;
  if (!voices.length) return null;

  const requested = env('EXPO_PUBLIC_AGA_WEB_TTS_VOICE').trim().toLowerCase();
  if (requested) {
    const exact = voices.find((voice) => String(voice.name ?? '').toLowerCase() === requested);
    if (exact) return exact;
    const fuzzy = voices.find((voice) => String(voice.name ?? '').toLowerCase().includes(requested));
    if (fuzzy) return fuzzy;
  }

  const wanted = locale.toLowerCase();
  return [...voices].sort((a, b) => voiceScore(b, wanted) - voiceScore(a, wanted))[0] ?? null;
}

function softenForSpeech(text: string) {
  return text
    .replace(/AGA/g, 'Aga')
    .replace(/\s+/g, ' ')
    .replace(/\.\s+/g, '.  ')
    .replace(/!\s+/g, '!  ')
    .replace(/\?\s+/g, '?  ')
    .trim();
}

function emotionFromText(text: string, prefs: Preferences): ElevenLabsEmotion {
  const session = String((prefs as any)?.activeSession?.label || (prefs as any)?.activeSession?.kind || '').toLowerCase();
  const lower = text.toLowerCase();
  if (/hypnosis|subconscious|trance|deepening/.test(session) || /hypnosis|subconscious|trance/.test(lower)) return 'hypnosis';
  if (/breath|meditation|body scan|bedtime|guided/.test(session) || /breathe|inhale|exhale|notice your body/.test(lower)) return 'guided';
  if (/conflict|repair|argument|forgive|boundary/.test(session) || /conflict|argument|upset|hurt|angry/.test(lower)) return 'conflict';
  if (/warning|danger|emergency|urgent|stop now/.test(lower)) return 'urgent';
  if (/calm|soft|gently|slowly/.test(lower)) return 'calm';
  return 'warm';
}

export function getTtsDiagnostics(): TtsDiagnostics {
  return { ...diagnostics, speaking, elevenLabs: getElevenLabsDiagnostics() };
}

export async function isTtsAvailable() {
  if (await isElevenLabsAvailable()) return true;
  const web = getWebSpeech();
  if (web) return true;
  const Speech = await importSpeech();
  return !!Speech?.speak;
}

/**
 * Best-effort browser/native audio unlock. Must be called from a user gesture on
 * web. On native, this primes whichever provider is installed/configured.
 */
export async function primeTts(locale = 'en-US') {
  return measureAsync('voice.tts.prime', async () => {
    if (await isElevenLabsAvailable()) {
      diagnostics.provider = 'elevenlabs';
      diagnostics.available = true;
      diagnostics.unlocked = true;
      diagnostics.lastError = null;
      return true;
    }

    const web = getWebSpeech();
    if (web) {
      diagnostics.provider = 'web-speech';
      diagnostics.available = true;
      try {
        const utterance = new web.Utterance(' ');
        utterance.lang = locale;
        utterance.volume = 0;
        utterance.rate = 1;
        utterance.pitch = 1;
        web.synth.cancel?.();
        web.synth.speak(utterance);
        diagnostics.unlocked = true;
        diagnostics.lastError = null;
        measureMark('voice.tts.unlocked', { provider: 'web-speech' });
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? 'web speech prime failed');
        diagnostics.lastError = message;
        diagnostics.errors += 1;
        measureMark('voice.tts.prime.error', { provider: 'web-speech', message });
        return false;
      }
    }

    const Speech = await importSpeech();
    if (Speech?.speak && allowExpoFallback()) {
      diagnostics.provider = 'expo-speech';
      diagnostics.available = true;
      diagnostics.unlocked = true;
      return true;
    }

    diagnostics.provider = 'none';
    diagnostics.available = false;
    diagnostics.lastError = 'No expressive speech synthesis provider is available.';
    return false;
  }, { platform: Platform.OS, locale });
}

export async function stopSpeaking() {
  return measureAsync('voice.tts.stop', async () => {
    speaking = false;
    diagnostics.speaking = false;
    currentUtterance = null;
    await stopElevenLabsSpeech().catch(() => undefined);
    try {
      currentAudio?.pause?.();
      if (currentAudio?.src && typeof URL !== 'undefined' && String(currentAudio.src).startsWith('blob:')) {
        URL.revokeObjectURL(currentAudio.src);
      }
    } catch {
      // ignore audio teardown issues
    }
    currentAudio = null;

    const web = getWebSpeech();
    try {
      web?.synth?.cancel?.();
    } catch {
      // ignore browser teardown issues
    }

    const Speech = await importSpeech();
    try {
      await Speech?.stop?.();
    } catch {
      // ignore native/web TTS teardown issues
    }
  });
}

async function speakWithOpenAiWebTts(clean: string, prefs: Preferences, callbacks?: TtsCallbacks) {
  if (Platform.OS !== 'web') return false;
  const key = openAiApiKey();
  if (!key) return false;

  diagnostics.provider = 'openai-tts';
  diagnostics.available = true;
  await stopSpeaking();

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let objectUrl: string | null = null;
    const done = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      try {
        currentAudio?.pause?.();
        if (objectUrl && typeof URL !== 'undefined') URL.revokeObjectURL(objectUrl);
      } catch {
        // ignore audio cleanup
      }
      currentAudio = null;
      finish(callbacks, error);
      resolve(ok);
    };

    (async () => {
      try {
        const persona = getPersona(prefs.persona);
        const model = env('EXPO_PUBLIC_OPENAI_TTS_MODEL') || 'gpt-4o-mini-tts';
        const voice = env('EXPO_PUBLIC_OPENAI_TTS_VOICE') || 'shimmer';
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            voice,
            input: softenForSpeech(clean),
            response_format: 'mp3',
            speed: Math.max(0.75, Math.min(1.05, persona.rate)),
          }),
        });
        if (!response.ok) {
          const message = await response.text().catch(() => 'OpenAI TTS request failed');
          done(false, `OpenAI TTS failed: ${message.slice(0, 160)}`);
          return;
        }
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        const AudioCtor = (globalThis as any).Audio;
        if (!AudioCtor) {
          done(false, 'Browser Audio element is unavailable.');
          return;
        }
        const audio = new AudioCtor(objectUrl);
        currentAudio = audio;
        audio.onplay = () => {
          diagnostics.unlocked = true;
          diagnostics.lastVoiceName = `openai:${voice}`;
          measureMark('voice.tts.openai.start', { chars: clean.length, model, voice });
        };
        audio.onended = () => done(true);
        audio.onerror = () => done(false, 'OpenAI TTS audio playback failed or was blocked by the browser.');

        speaking = true;
        diagnostics.speaking = true;
        diagnostics.starts += 1;
        diagnostics.lastStartedAt = new Date().toISOString();
        diagnostics.lastTextChars = clean.length;
        diagnostics.lastError = null;
        callbacks?.onStart?.();
        await audio.play();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? 'OpenAI TTS failed');
        done(false, message);
      }
    })();
  });
}

async function speakWithWebSpeech(clean: string, prefs: Preferences, callbacks?: TtsCallbacks) {
  const web = getWebSpeech();
  if (!web) return false;
  diagnostics.provider = 'web-speech';
  diagnostics.available = true;

  const persona = getPersona(prefs.persona);
  await stopSpeaking();

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      currentUtterance = null;
      finish(callbacks, error);
      resolve(ok);
    };

    try {
      const spoken = softenForSpeech(clean);
      const utterance = new web.Utterance(spoken);
      currentUtterance = utterance;
      utterance.lang = prefs.voiceLocale || 'en-US';
      utterance.rate = Math.max(0.72, Math.min(1.02, persona.rate));
      utterance.pitch = Math.max(0.85, Math.min(1.08, persona.pitch));
      utterance.volume = 1;
      const selectedVoice = chooseWebVoice(utterance.lang);
      if (selectedVoice) utterance.voice = selectedVoice;
      diagnostics.lastVoiceName = selectedVoice?.name ?? null;

      utterance.onstart = () => {
        diagnostics.unlocked = true;
        measureMark('voice.tts.web.start', { chars: clean.length, voice: selectedVoice?.name ?? null, lang: selectedVoice?.lang ?? utterance.lang, rate: utterance.rate, pitch: utterance.pitch });
      };
      utterance.onend = () => done(true);
      utterance.onerror = (event: any) => done(false, String(event?.error || event?.message || 'web speech synthesis error'));

      speaking = true;
      diagnostics.speaking = true;
      diagnostics.starts += 1;
      diagnostics.lastStartedAt = new Date().toISOString();
      diagnostics.lastTextChars = clean.length;
      diagnostics.lastError = null;
      callbacks?.onStart?.();
      web.synth.cancel?.();
      web.synth.speak(utterance);

      setTimeout(() => {
        if (!settled && speaking && web.synth.paused) {
          done(false, 'Browser speech synthesis appears paused or locked. AGA will still show replies in the feed.');
        }
      }, 1200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? 'web speech synthesis failed');
      done(false, message);
    }
  });
}

async function speakWithExpoSpeech(clean: string, prefs: Preferences, callbacks?: TtsCallbacks) {
  if (!allowExpoFallback()) return false;
  const Speech = await importSpeech();
  if (!Speech?.speak) return false;
  diagnostics.provider = 'expo-speech';
  diagnostics.available = true;

  const persona = getPersona(prefs.persona);
  await stopSpeaking();

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      finish(callbacks, error);
      resolve(ok);
    };

    try {
      speaking = true;
      diagnostics.speaking = true;
      diagnostics.starts += 1;
      diagnostics.lastStartedAt = new Date().toISOString();
      diagnostics.lastTextChars = clean.length;
      diagnostics.lastError = null;
      callbacks?.onStart?.();
      Speech.speak(softenForSpeech(clean), {
        language: prefs.voiceLocale || 'en-US',
        rate: Math.max(0.72, Math.min(1.02, persona.rate)),
        pitch: Math.max(0.85, Math.min(1.08, persona.pitch)),
        onDone: () => done(true),
        onStopped: () => done(true),
        onError: (error: any) => done(false, String(error?.message || error || 'expo speech error')),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? 'expo speech failed');
      done(false, message);
    }
  });
}

async function speakWithElevenLabsPrimary(clean: string, prefs: Preferences, callbacks?: TtsCallbacks) {
  if (!(await isElevenLabsAvailable())) return false;
  diagnostics.provider = 'elevenlabs';
  diagnostics.available = true;
  diagnostics.unlocked = true;
  speaking = true;
  diagnostics.speaking = true;
  diagnostics.starts += 1;
  diagnostics.lastStartedAt = new Date().toISOString();
  diagnostics.lastTextChars = clean.length;
  diagnostics.lastError = null;
  diagnostics.lastVoiceName = `elevenlabs:${env('EXPO_PUBLIC_ELEVENLABS_VOICE_ID') || 'configured'}`;

  const ok = await speakWithElevenLabs(clean, {
    locale: prefs.voiceLocale || 'en-US',
    emotion: emotionFromText(clean, prefs),
    cacheKey: `aga-${Date.now()}`,
    onStart: callbacks?.onStart,
    onError: callbacks?.onError,
  });
  if (!ok) {
    diagnostics.errors += 1;
    diagnostics.lastError = getElevenLabsDiagnostics().lastError;
  }
  speaking = false;
  diagnostics.speaking = false;
  diagnostics.lastFinishedAt = new Date().toISOString();
  diagnostics.finishes += 1;
  callbacks?.onDone?.();
  return ok;
}

export async function speak(text: string, prefs: Preferences, callbacks?: TtsCallbacks) {
  return measureAsync('voice.tts.speak', async () => {
    const clean = text.trim();
    if (!clean) {
      callbacks?.onDone?.();
      return false;
    }

    const provider = preferProvider();
    if (provider === 'elevenlabs' || provider === '11labs' || provider === 'expressive') {
      const elevenOk = await speakWithElevenLabsPrimary(clean, prefs, callbacks);
      if (elevenOk) return true;
      // Fall through only for resilience; Android robotic TTS is now an emergency
      // path, not AGA's normal personality.
    }

    if (preferOpenAiTts()) {
      const openAiOk = await speakWithOpenAiWebTts(clean, prefs, callbacks);
      if (openAiOk) return true;
    }

    if (Platform.OS === 'web') {
      const webOk = await speakWithWebSpeech(clean, prefs, callbacks);
      if (webOk) return true;
    }

    const expoOk = await speakWithExpoSpeech(clean, prefs, callbacks);
    if (expoOk) return true;

    const message = 'No expressive speech synthesis provider is available. Configure ElevenLabs or enable/rebuild expo-speech fallback.';
    diagnostics.provider = 'none';
    diagnostics.available = false;
    finish(callbacks, message);
    return false;
  }, { chars: text.length, platform: Platform.OS });
}

export function isSpeaking() {
  return speaking || getElevenLabsDiagnostics().speaking;
}
