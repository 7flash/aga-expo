import { speakWithElevenLabs, stopElevenLabsSpeech, type ElevenLabsEmotion } from '../elevenLabsTts';
import type { BrowserTtsLayer } from './types';
import { beginAssistantSpeech, endAssistantSpeech, abortAssistantSpeech } from '../speakListenGate';

export class ElevenLabsVoiceLayer implements BrowserTtsLayer {
  readonly name = 'elevenlabs-tts';

  async speak(text: string, options: { emotion?: string; signal?: AbortSignal } = {}) {
    if (!String(text || '').trim()) return;
    const speechId = beginAssistantSpeech('elevenlabs_tts');
    try {
      await speakWithElevenLabs(text, { emotion: (options.emotion as ElevenLabsEmotion) || 'warm' });
    } finally {
      endAssistantSpeech(speechId, 900);
    }
  }

  async stop() {
    abortAssistantSpeech('elevenlabs_tts_stop');
    await stopElevenLabsSpeech();
  }
}

export class BrowserSpeechSynthesisFallbackLayer implements BrowserTtsLayer {
  readonly name = 'browser-speech-synthesis';

  async speak(text: string) {
    const synth = globalThis.speechSynthesis;
    const Utterance = (globalThis as any).SpeechSynthesisUtterance;
    if (!synth || !Utterance) throw new Error('No browser speech synthesis fallback is available.');
    const speechId = beginAssistantSpeech('browser_speech_synthesis');
    try {
      await new Promise<void>((resolve, reject) => {
      const utterance = new Utterance(text);
      utterance.rate = 0.95;
      utterance.pitch = 1.0;
      utterance.onend = () => resolve();
      utterance.onerror = (event: unknown) => reject(new Error(`Speech synthesis failed: ${JSON.stringify(event)}`));
      synth.cancel();
      synth.speak(utterance);
      });
    } finally {
      endAssistantSpeech(speechId, 900);
    }
  }

  stop() {
    abortAssistantSpeech('browser_speech_synthesis_stop');
    globalThis.speechSynthesis?.cancel?.();
  }
}
