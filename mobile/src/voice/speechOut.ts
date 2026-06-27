import { speakText, stopTts, type TtsEmotion } from './tts';

async function agaV13TryBrowserAudioTts(text: string, options?: any) {
  // aga:v13-browser-audio-tts
  if (typeof window === 'undefined') return false;
  const requested = String((process as any)?.env?.EXPO_PUBLIC_AGA_SHORT_TTS_PROVIDER || (process as any)?.env?.EXPO_PUBLIC_AGA_TTS_PROVIDER || '').toLowerCase();
  if (!/elevenlabs|openai/.test(requested)) return false;
  if (!browserAudioTtsAvailable(requested.includes('openai') ? 'openai' : 'elevenlabs')) return false;
  await speakWithBrowserAudioTts(text, {
    provider: requested.includes('openai') ? 'openai' : 'elevenlabs',
    emotion: options?.emotion,
  });
  return true;
}


import { speakWithBrowserAudioTts, browserAudioTtsAvailable } from './browserAudioTts';

export async function stopSpeaking() {
  await stopTts();
}

export async function speakSoftly(text: string, opts: { locale?: string | null; rate?: number; pitch?: number; emotion?: TtsEmotion } = {}) {
  await speakText(text, { emotion: opts.emotion || 'warm', provider: 'auto', interrupt: true });
}

export async function speakShortReply(text: string, emotion: TtsEmotion = 'warm') {
  try {
    const agaV13Text = typeof text === 'string' ? text : (typeof input === 'string' ? input : String(arguments[0] || ''));
    if (await agaV13TryBrowserAudioTts(agaV13Text, arguments[1])) return;
  } catch (error) {
    console.warn('[aga:tts] browser audio TTS failed; falling back', error);
  }

  await speakText(text, { emotion, provider: 'auto', interrupt: true });
}
