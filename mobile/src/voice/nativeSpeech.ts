import { Platform } from 'react-native';
import { measureMark } from '../observability/measure';

export type SpeechCallbacks = {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
  onStatus?: (status: string) => void;
};

export type SpeechDiagnostics = {
  available: boolean;
  provider: 'porcupine-only' | 'web-dev' | 'none';
  listening: boolean;
  restarts: number;
  lastError: string | null;
  lastFinal: string | null;
  lastStartedAt: string | null;
  permission: 'not_required' | 'unavailable';
};

/**
 * Deprecated speech-recognition loop.
 *
 * AGA appliance builds do not use Android SpeechRecognizer or @react-native-voice
 * as the hot mic. Porcupine detects exact local keywords, then Gemini/OpenAI live
 * sessions receive audio only after wake. This class remains as a no-op dev
 * compatibility shim for older imports.
 */
export class NativeSpeechLoop {
  private callbacks: SpeechCallbacks;
  private listening = false;
  private lastStartedAt: string | null = null;
  private lastError: string | null = null;

  constructor(callbacks: SpeechCallbacks = {}) {
    this.callbacks = callbacks;
  }

  async start() {
    this.listening = false;
    this.lastStartedAt = new Date().toISOString();
    const message = Platform.OS === 'web'
      ? 'NativeSpeechLoop disabled; use browser harness manually or Porcupine on device.'
      : 'NativeSpeechLoop disabled; Porcupine is the only always-on wake path.';
    this.callbacks.onStatus?.(message);
    measureMark('voice.nativeSpeech.disabled', { platform: Platform.OS });
  }

  async stop() {
    this.listening = false;
    this.callbacks.onStatus?.('NativeSpeechLoop stopped.');
  }

  getDiagnostics(): SpeechDiagnostics {
    return {
      available: false,
      provider: Platform.OS === 'web' ? 'web-dev' : 'porcupine-only',
      listening: this.listening,
      restarts: 0,
      lastError: this.lastError,
      lastFinal: null,
      lastStartedAt: this.lastStartedAt,
      permission: 'not_required',
    };
  }
}
