import { Platform } from 'react-native';
import { emptyVoiceDiagnostics, type VoiceDiagnostics } from './voiceDiagnostics';

declare const require: any;

type SpeechCallbacks = {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onWatchdogRestart?: (diagnostics: VoiceDiagnostics) => void;
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
  private restartReason: string | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private lastFinalText = '';
  private lastFinalAt = 0;
  private lastEngineActivityAt = 0;
  private restartDelayMs = Platform.OS === 'android' ? 450 : 250;
  private watchdogEnabled = true;
  private diagnostics = emptyVoiceDiagnostics();

  constructor(callbacks: SpeechCallbacks, locale = 'en-US') {
    this.callbacks = callbacks;
    this.locale = locale;
  }

  async start(options: { watchdogEnabled?: boolean; locale?: string } = {}) {
    const Voice = loadVoice();
    if (!Voice) {
      this.callbacks.onError?.('Native speech recognition is not installed. Add @react-native-voice/voice for full voice input.');
      return;
    }

    this.locale = options.locale ?? this.locale;
    this.watchdogEnabled = options.watchdogEnabled ?? this.watchdogEnabled;
    this.running = true;
    this.diagnostics.running = true;
    Voice.onSpeechStart = () => {
      this.lastEngineActivityAt = Date.now();
      this.callbacks.onStart?.();
    };
    Voice.onSpeechEnd = () => {
      this.lastEngineActivityAt = Date.now();
      this.callbacks.onEnd?.();
      this.scheduleRestart('speech_end');
    };
    Voice.onSpeechError = (event: any) => {
      const message = event?.error?.message ?? event?.error?.code ?? 'Speech recognition error.';
      this.diagnostics.errors += 1;
      this.diagnostics.lastError = String(message);
      this.lastEngineActivityAt = Date.now();
      this.callbacks.onError?.(String(message));
      this.scheduleRestart('speech_error');
    };
    Voice.onSpeechPartialResults = (event: any) => {
      const text = event?.value?.[0];
      this.lastEngineActivityAt = Date.now();
      if (text) {
        this.diagnostics.partials += 1;
        this.callbacks.onPartial?.(String(text));
      }
    };
    Voice.onSpeechResults = (event: any) => {
      const text = event?.value?.[0];
      this.lastEngineActivityAt = Date.now();
      if (text) {
        const normalized = String(text).replace(/\s+/g, ' ').trim();
        const now = Date.now();
        const duplicate = normalized.toLowerCase() === this.lastFinalText.toLowerCase() && now - this.lastFinalAt < 1800;
        if (normalized && !duplicate) {
          this.lastFinalText = normalized;
          this.lastFinalAt = now;
          this.diagnostics.finals += 1;
          this.diagnostics.lastFinalAt = new Date(now).toISOString();
          this.callbacks.onFinal?.(normalized);
        }
      }
      this.scheduleRestart('speech_results');
    };

    this.startWatchdog();
    await this.safeStart(false);
  }

  async stop() {
    this.running = false;
    this.diagnostics.running = false;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    if (this.watchdogTimer) { clearInterval(this.watchdogTimer); this.watchdogTimer = null; }
    const Voice = loadVoice();
    if (!Voice) return;
    try { await Voice.stop(); } catch {}
  }

  async destroy() {
    this.running = false;
    this.diagnostics.running = false;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    if (this.watchdogTimer) { clearInterval(this.watchdogTimer); this.watchdogTimer = null; }
    const Voice = loadVoice();
    if (!Voice) return;
    try { await Voice.destroy(); } catch {}
    Voice.removeAllListeners?.();
  }

  setWatchdogEnabled(enabled: boolean) {
    this.watchdogEnabled = enabled;
    if (enabled) this.startWatchdog();
    else if (this.watchdogTimer) clearInterval(this.watchdogTimer);
  }

  getDiagnostics(): VoiceDiagnostics {
    return { ...this.diagnostics, running: this.running };
  }

  private scheduleRestart(reason = 'restart') {
    if (!this.running) return;
    if (this.restartTimer) return;
    this.restartReason = reason;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      const nextReason = this.restartReason ?? reason;
      this.restartReason = null;
      void this.safeStart(true, nextReason);
    }, this.restartDelayMs);
  }

  private startWatchdog() {
    if (this.watchdogTimer) { clearInterval(this.watchdogTimer); this.watchdogTimer = null; }
    if (!this.watchdogEnabled) return;
    this.watchdogTimer = setInterval(() => {
      if (!this.running || !this.watchdogEnabled) return;
      const silentMs = Date.now() - (this.lastEngineActivityAt || Date.now());
      if (silentMs > 22_000) {
        this.callbacks.onWatchdogRestart?.(this.getDiagnostics());
        this.scheduleRestart('watchdog_silence');
      }
    }, 7_500);
  }

  private async safeStart(isRestart: boolean, reason = 'start') {
    const Voice = loadVoice();
    if (!Voice || !this.running) return;
    try {
      this.lastEngineActivityAt = Date.now();
      this.diagnostics.starts += 1;
      this.diagnostics.lastStartAt = new Date().toISOString();
      if (isRestart) this.diagnostics.restarts += 1;
      this.diagnostics.lastRestartReason = isRestart ? reason : this.diagnostics.lastRestartReason;
      await Voice.start(this.locale);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not restart speech recognition.';
      this.diagnostics.errors += 1;
      this.diagnostics.lastError = message;
      this.callbacks.onError?.(message);
      this.scheduleRestart('safe_start_failed');
    }
  }
}
