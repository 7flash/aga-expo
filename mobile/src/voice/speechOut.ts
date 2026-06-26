import { speakWithElevenLabs, stopElevenLabsSpeech } from './elevenLabsTts';

function env(name: string) {
  return process.env?.[name] ?? '';
}

function langForLocale(locale?: string | null) {
  return String(locale || env('EXPO_PUBLIC_AGA_SPEAK_LOCALE') || 'en-US');
}

function allowExpoFallback() {
  return String(env('EXPO_PUBLIC_AGA_ALLOW_EXPO_SPEECH_FALLBACK') || '1') !== '0';
}

export async function stopSpeaking() {
  await stopElevenLabsSpeech().catch(() => undefined);
  const root: any = globalThis as any;
  try { root?.speechSynthesis?.cancel?.(); } catch { /* ignore */ }
  try {
    const req = (0, eval)('typeof require !== "undefined" ? require : null');
    const Speech = req?.('expo-speech');
    await Speech?.stop?.();
  } catch { /* optional */ }
}

export async function speakSoftly(text: string, opts: { locale?: string | null; rate?: number; pitch?: number; emotion?: 'warm' | 'calm' | 'guided' | 'hypnosis' | 'conflict' } = {}) {
  const clean = String(text || '').trim();
  if (!clean) return;
  const locale = langForLocale(opts.locale);

  // Local/tool responses should sound like AGA even when realtime audio is not
  // connected. ElevenLabs is primary; expo-speech is only an emergency fallback.
  const elevenOk = await speakWithElevenLabs(clean, {
    locale,
    emotion: opts.emotion || 'calm',
    cacheKey: `aga-soft-${Date.now()}`,
  }).catch(() => false);
  if (elevenOk) return;

  const root: any = globalThis as any;
  const rate = Number(env('EXPO_PUBLIC_AGA_GEMINI_TTS_RATE') || opts.rate || 0.88);
  const pitch = Number(env('EXPO_PUBLIC_AGA_GEMINI_TTS_PITCH') || opts.pitch || 1.06);

  if (root?.speechSynthesis && root?.SpeechSynthesisUtterance) {
    await stopSpeaking();
    await new Promise<void>((resolve) => {
      const utterance = new root.SpeechSynthesisUtterance(clean);
      utterance.lang = locale;
      utterance.rate = Number.isFinite(rate) ? rate : 0.88;
      utterance.pitch = Number.isFinite(pitch) ? pitch : 1.06;
      utterance.volume = 1;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      root.speechSynthesis.speak(utterance);
    });
    return;
  }

  if (!allowExpoFallback()) return;
  try {
    const req = (0, eval)('typeof require !== "undefined" ? require : null');
    const Speech = req?.('expo-speech');
    if (Speech?.speak) {
      await stopSpeaking();
      await new Promise<void>((resolve) => {
        Speech.speak(clean, {
          language: locale,
          rate: Number.isFinite(rate) ? rate : 0.88,
          pitch: Number.isFinite(pitch) ? pitch : 1.06,
          onDone: resolve,
          onStopped: resolve,
          onError: resolve,
        });
      });
    }
  } catch { /* no local speech output available */ }
}
