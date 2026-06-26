import { speakText, stopTts, type TtsEmotion } from './tts';

export async function stopSpeaking() {
  await stopTts();
}

export async function speakSoftly(text: string, opts: { locale?: string | null; rate?: number; pitch?: number; emotion?: TtsEmotion } = {}) {
  await speakText(text, { emotion: opts.emotion || 'warm', provider: 'auto', interrupt: true });
}

export async function speakShortReply(text: string, emotion: TtsEmotion = 'warm') {
  await speakText(text, { emotion, provider: 'auto', interrupt: true });
}
