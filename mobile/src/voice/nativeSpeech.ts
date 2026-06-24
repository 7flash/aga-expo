type SpeechCallbacks = {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
  onStatus?: (status: string) => void;
};

type VoiceModule = any;

type Diagnostics = {
  available: boolean;
  listening: boolean;
  restarts: number;
  lastError: string | null;
  lastFinal: string | null;
  lastStartedAt: string | null;
};

async function importVoice(): Promise<VoiceModule | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-voice/voice');
    return mod?.default ?? mod;
  } catch {
    return null;
  }
}

export class NativeSpeechLoop {
  private callbacks: SpeechCallbacks;
  private locale: string;
  private voice: VoiceModule | null = null;
  private destroyed = false;
  private restarting = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFinalFingerprint = '';
  diagnostics: Diagnostics = {
    available: false,
    listening: false,
    restarts: 0,
    lastError: null,
    lastFinal: null,
    lastStartedAt: null,
  };

  constructor(callbacks: SpeechCallbacks, locale = 'en-US') {
    this.callbacks = callbacks;
    this.locale = locale;
  }

  updateCallbacks(callbacks: SpeechCallbacks) {
    this.callbacks = callbacks;
  }

  async start() {
    this.destroyed = false;
    this.voice = await importVoice();
    this.diagnostics.available = !!this.voice;
    if (!this.voice) {
      this.diagnostics.lastError = '@react-native-voice/voice is not installed in this build.';
      this.callbacks.onError?.(this.diagnostics.lastError);
      return;
    }

    this.voice.onSpeechStart = () => {
      this.diagnostics.listening = true;
      this.callbacks.onStatus?.('listening');
    };
    this.voice.onSpeechEnd = () => {
      this.diagnostics.listening = false;
      this.callbacks.onStatus?.('restarting');
      this.scheduleRestart('speech_end');
    };
    this.voice.onSpeechPartialResults = (event: any) => {
      const text = event?.value?.[0] ?? '';
      if (text) this.callbacks.onPartial?.(text);
    };
    this.voice.onSpeechResults = (event: any) => {
      const text = String(event?.value?.[0] ?? '').trim();
      if (!text) return;
      const fingerprint = `${text.toLowerCase()}::${Math.floor(Date.now() / 1200)}`;
      if (fingerprint === this.lastFinalFingerprint) return;
      this.lastFinalFingerprint = fingerprint;
      this.diagnostics.lastFinal = text;
      this.callbacks.onFinal?.(text);
      this.scheduleRestart('result');
    };
    this.voice.onSpeechError = (event: any) => {
      const message = event?.error?.message || event?.error?.code || 'Speech recognition error.';
      this.diagnostics.lastError = String(message);
      this.diagnostics.listening = false;
      this.callbacks.onError?.(String(message));
      this.scheduleRestart('error');
    };

    await this.safeStart(false, 'initial');
  }

  private scheduleRestart(reason: string) {
    if (this.destroyed || this.restarting || this.restartTimer) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.safeStart(true, reason);
    }, 450);
  }

  private async safeStart(isRestart: boolean, reason: string) {
    if (this.destroyed || !this.voice) return;
    this.restarting = true;
    try {
      try { await this.voice.cancel?.(); } catch {}
      try { await this.voice.stop?.(); } catch {}
      if (isRestart) this.diagnostics.restarts += 1;
      this.diagnostics.lastStartedAt = new Date().toISOString();
      await this.voice.start(this.locale);
      this.diagnostics.listening = true;
      this.callbacks.onStatus?.(isRestart ? `restarted:${reason}` : 'started');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start speech recognition.';
      this.diagnostics.lastError = message;
      this.diagnostics.listening = false;
      this.callbacks.onError?.(message);
    } finally {
      this.restarting = false;
    }
  }

  async destroy() {
    this.destroyed = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    try { await this.voice?.destroy?.(); } catch {}
    try { this.voice?.removeAllListeners?.(); } catch {}
    this.diagnostics.listening = false;
  }
}
