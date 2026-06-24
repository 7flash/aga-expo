import { NativeEventEmitter, Platform } from 'react-native';

declare const require: any;

type SpeechCallbacks = {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
};

type VoiceModule = {
  start: (locale: string) => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => Promise<void>;
  destroy: () => Promise<void>;
  removeAllListeners?: () => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  onSpeechError?: (event: any) => void;
  onSpeechResults?: (event: any) => void;
  onSpeechPartialResults?: (event: any) => void;
};

let cachedVoice: VoiceModule | null | undefined;

function loadVoice(): VoiceModule | null {
  if (cachedVoice !== undefined) return cachedVoice;
  try {
    cachedVoice = require('@react-native-voice/voice').default as VoiceModule;
  } catch {
    cachedVoice = null;
  }
  return cachedVoice;
}

export function isNativeSpeechAvailable() {
  return !!loadVoice();
}

export class NativeSpeechLoop {
  private callbacks: SpeechCallbacks;
  private locale: string;
  private running = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(callbacks: SpeechCallbacks, locale = 'en-US') {
    this.callbacks = callbacks;
    this.locale = locale;
  }

  async start() {
    const Voice = loadVoice();
    if (!Voice) {
      this.callbacks.onError?.('Native speech recognition is not installed. Add @react-native-voice/voice for full voice input.');
      return;
    }

    this.running = true;
    Voice.onSpeechStart = () => this.callbacks.onStart?.();
    Voice.onSpeechEnd = () => {
      this.callbacks.onEnd?.();
      this.scheduleRestart();
    };
    Voice.onSpeechError = (event: any) => {
      this.callbacks.onError?.(event?.error?.message ?? event?.error?.code ?? 'Speech recognition error.');
      this.scheduleRestart();
    };
    Voice.onSpeechPartialResults = (event: any) => {
      const text = event?.value?.[0];
      if (text) this.callbacks.onPartial?.(String(text));
    };
    Voice.onSpeechResults = (event: any) => {
      const text = event?.value?.[0];
      if (text) this.callbacks.onFinal?.(String(text));
      this.scheduleRestart();
    };

    await this.safeStart();
  }

  async stop() {
    this.running = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    const Voice = loadVoice();
    if (!Voice) return;
    try { await Voice.stop(); } catch {}
  }

  async destroy() {
    this.running = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    const Voice = loadVoice();
    if (!Voice) return;
    try { await Voice.destroy(); } catch {}
    Voice.removeAllListeners?.();
  }

  private scheduleRestart() {
    if (!this.running) return;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => void this.safeStart(), Platform.OS === 'android' ? 450 : 250);
  }

  private async safeStart() {
    const Voice = loadVoice();
    if (!Voice || !this.running) return;
    try {
      await Voice.start(this.locale);
    } catch (error) {
      this.callbacks.onError?.(error instanceof Error ? error.message : 'Could not restart speech recognition.');
      this.scheduleRestart();
    }
  }
}
