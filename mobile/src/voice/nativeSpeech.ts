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
  lastPartialAt: string | null;
  lastRestartReason: string | null;
  restartBackoffMs: number;
  restartPending: boolean;
  watchdogTicks: number;
  teardownErrors: number;
};

type StartOptions = {
  watchdogEnabled?: boolean;
};

const INITIAL_BACKOFF_MS = 450;
const MAX_BACKOFF_MS = 4000;
const WATCHDOG_INTERVAL_MS = 15000;
const STALE_ENGINE_MS = 90000;

async function importVoice(): Promise<VoiceModule | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-voice/voice');
    return mod?.default ?? mod;
  } catch {
    return null;
  }
}

function doubleBackoff(current: number) {
  return Math.min(MAX_BACKOFF_MS, Math.max(INITIAL_BACKOFF_MS, current * 2));
}

export class NativeSpeechLoop {
  private callbacks: SpeechCallbacks;
  private locale: string;
  private voice: VoiceModule | null = null;
  private destroyed = false;
  private restarting = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogEnabled = true;
  private lastFinalFingerprint = '';
  diagnostics: Diagnostics = {
    available: false,
    listening: false,
    restarts: 0,
    lastError: null,
    lastFinal: null,
    lastStartedAt: null,
    lastPartialAt: null,
    lastRestartReason: null,
    restartBackoffMs: INITIAL_BACKOFF_MS,
    restartPending: false,
    watchdogTicks: 0,
    teardownErrors: 0,
  };

  constructor(callbacks: SpeechCallbacks, locale = 'en-US') {
    this.callbacks = callbacks;
    this.locale = locale;
  }

  updateCallbacks(callbacks: SpeechCallbacks) {
    this.callbacks = callbacks;
  }

  async start(options: StartOptions = {}) {
    this.destroyed = false;
    this.watchdogEnabled = options.watchdogEnabled !== false;
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
      this.callbacks.onStatus?.('speech ended; arming again');
      this.scheduleRestart('speech_end');
    };
    this.voice.onSpeechPartialResults = (event: any) => {
      const text = event?.value?.[0] ?? '';
      this.diagnostics.lastPartialAt = new Date().toISOString();
      this.diagnostics.lastError = null;
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

    this.startWatchdog();
    await this.safeStart(false, 'initial');
  }

  private startWatchdog() {
    if (!this.watchdogEnabled || this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => {
      if (this.destroyed || !this.voice) return;
      this.diagnostics.watchdogTicks += 1;

      const lastActivity = this.diagnostics.lastPartialAt || this.diagnostics.lastStartedAt;
      const staleFor = lastActivity ? Date.now() - new Date(lastActivity).getTime() : Number.POSITIVE_INFINITY;

      // Silence is normal. Restart only if the engine appears unarmed for a long time.
      if (!this.diagnostics.listening && staleFor > STALE_ENGINE_MS) {
        this.callbacks.onStatus?.('speech watchdog soft restart');
        this.scheduleRestart('watchdog_stale_unarmed');
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  private clearWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  private scheduleRestart(reason: string) {
    if (this.destroyed || this.restarting || this.restartTimer) return;
    this.diagnostics.lastRestartReason = reason;
    this.diagnostics.restartPending = true;
    const delay = this.diagnostics.restartBackoffMs;
    this.callbacks.onStatus?.(`restart scheduled:${reason}:${delay}ms`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.diagnostics.restartPending = false;
      void this.safeStart(true, reason);
    }, delay);
  }

  private reportTeardownError(action: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error || 'unknown teardown error');
    this.diagnostics.teardownErrors += 1;
    this.diagnostics.lastError = `${action}: ${message}`;
    this.callbacks.onError?.(this.diagnostics.lastError);
  }

  private async safeCancelOrStop(action: 'cancel' | 'stop') {
    try {
      await this.voice?.[action]?.();
    } catch (error) {
      this.reportTeardownError(`voice.${action}`, error);
    }
  }

  private async safeStart(isRestart: boolean, reason: string) {
    if (this.destroyed || !this.voice) return;
    this.restarting = true;
    try {
      if (isRestart) {
        await this.safeCancelOrStop('cancel');
        await this.safeCancelOrStop('stop');
        this.diagnostics.restarts += 1;
      }
      this.diagnostics.lastStartedAt = new Date().toISOString();
      this.diagnostics.lastRestartReason = isRestart ? reason : null;
      await this.voice.start(this.locale);
      this.diagnostics.listening = true;
      this.diagnostics.lastError = null;
      this.diagnostics.restartBackoffMs = INITIAL_BACKOFF_MS;
      this.callbacks.onStatus?.(isRestart ? `restarted:${reason}` : 'started');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start speech recognition.';
      this.diagnostics.lastError = message;
      this.diagnostics.listening = false;
      this.diagnostics.restartBackoffMs = doubleBackoff(this.diagnostics.restartBackoffMs);
      this.callbacks.onError?.(message);
      this.scheduleRestart(`start_failed:${reason}`);
    } finally {
      this.restarting = false;
    }
  }

  async stop(reason = 'manual_stop') {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.diagnostics.restartPending = false;
    this.diagnostics.lastRestartReason = reason;
    await this.safeCancelOrStop('cancel');
    await this.safeCancelOrStop('stop');
    this.diagnostics.listening = false;
    this.callbacks.onStatus?.(`stopped:${reason}`);
  }

  async destroy() {
    this.destroyed = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.diagnostics.restartPending = false;
    this.clearWatchdog();
    try {
      await this.voice?.destroy?.();
    } catch (error) {
      this.reportTeardownError('voice.destroy', error);
    }
    try {
      this.voice?.removeAllListeners?.();
    } catch (error) {
      this.reportTeardownError('voice.removeAllListeners', error);
    }
    this.diagnostics.listening = false;
  }
}
