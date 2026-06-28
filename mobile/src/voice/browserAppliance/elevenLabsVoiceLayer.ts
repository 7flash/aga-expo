import { speakWithElevenLabs, stopElevenLabsSpeech, type ElevenLabsEmotion } from '../elevenLabsTts';
import type { BrowserTtsLayer } from './types';

export class ElevenLabsVoiceLayer implements BrowserTtsLayer {
  readonly name = 'elevenlabs-tts';

  async speak(text: string, options: { emotion?: string; signal?: AbortSignal } = {}) {
    if (!String(text || '').trim()) return;
    await speakWithElevenLabs(text, { emotion: (options.emotion as ElevenLabsEmotion) || 'warm' });
  }

  async stop() {
    await stopElevenLabsSpeech();
  }
}

export class BrowserSpeechSynthesisFallbackLayer implements BrowserTtsLayer {
  readonly name = 'browser-speech-synthesis';

  async speak(text: string) {
    const synth = globalThis.speechSynthesis;
    const Utterance = (globalThis as any).SpeechSynthesisUtterance;
    if (!synth || !Utterance) throw new Error('No browser speech synthesis fallback is available.');
    await new Promise<void>((resolve, reject) => {
      const utterance = new Utterance(text);
      utterance.rate = 0.95;
      utterance.pitch = 1.0;
      utterance.onend = () => resolve();
      utterance.onerror = (event: unknown) => reject(new Error(`Speech synthesis failed: ${JSON.stringify(event)}`));
      synth.cancel();
      synth.speak(utterance);
    });
  }

  stop() {
    globalThis.speechSynthesis?.cancel?.();
  }
}
