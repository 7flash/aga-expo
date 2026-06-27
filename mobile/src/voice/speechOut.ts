import { speakText, stopTts, type TtsEmotion } from './tts';

export async function stopSpeaking() {
  await stopTts();
}

export async function speakSoftly(text: string, opts: { locale?: string | null; rate?: number; pitch?: number; emotion?: TtsEmotion } = {}) {
  await speakText(text, { emotion: opts.emotion || 'warm', provider: 'auto', interrupt: true });
}

export async function speakShortReply(text: string, emotion: TtsEmotion = 'warm') {
  // Main hot path must go through tts.ts so ElevenLabs gateway/cache/native chunk
  // streaming is shared by browser and Android instead of bypassed by ad hoc calls.
  await speakText(text, { emotion, provider: 'auto', interrupt: true });
}
