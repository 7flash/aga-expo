function env(name: string) {
  return process.env?.[name] ?? '';
}

function langForLocale(locale?: string | null) {
  return String(locale || env('EXPO_PUBLIC_AGA_SPEAK_LOCALE') || 'en-US');
}

export async function stopSpeaking() {
  const root: any = globalThis as any;
  try { root?.speechSynthesis?.cancel?.(); } catch { /* ignore */ }
  // Native expo-speech is optional. Avoid a static import so web/APK builds do
  // not fail when it is not installed.
  try {
    const req = (0, eval)('typeof require !== "undefined" ? require : null');
    const Speech = req?.('expo-speech');
    await Speech?.stop?.();
  } catch { /* optional */ }
}

export async function speakSoftly(text: string, opts: { locale?: string | null; rate?: number; pitch?: number } = {}) {
  const clean = String(text || '').trim();
  if (!clean) return;
  const root: any = globalThis as any;
  const locale = langForLocale(opts.locale);
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
