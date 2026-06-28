import { speakText, stopTts, type TtsEmotion } from './tts';
import { markAssistantSpeaking, markAssistantSpeechDone, blockUserCapture } from './voiceTurnRuntime';

function clean(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export async function stopSpeaking() {
  blockUserCapture('speech stopped by user/control');
  await stopTts();
  markAssistantSpeechDone('stopSpeaking');
}

export async function speakSoftly(text: string, opts: { locale?: string | null; rate?: number; pitch?: number; emotion?: TtsEmotion } = {}) {
  const spoken = clean(text);
  if (!spoken) return;
  markAssistantSpeaking(spoken, 'speakSoftly');
  try {
    await speakText(spoken, { emotion: opts.emotion || 'warm', provider: 'auto', interrupt: true });
  } finally {
    // Keep the gate closed briefly so browser/Android mic does not wake on speaker echo.
    setTimeout(() => markAssistantSpeechDone('speakSoftly.done'), 650);
  }
}

export async function speakShortReply(text: string, emotion: TtsEmotion = 'warm') {
  const spoken = clean(text);
  if (!spoken) return;
  markAssistantSpeaking(spoken, 'speakShortReply');
  try {
    // Main hot path must go through tts.ts so ElevenLabs gateway/cache/native chunk
    // streaming is shared by browser and Android instead of bypassed by ad hoc calls.
    await speakText(spoken, { emotion, provider: 'auto', interrupt: true });
  } finally {
    setTimeout(() => markAssistantSpeechDone('speakShortReply.done'), 650);
  }
}
