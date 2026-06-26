import { PermissionsAndroid, Platform } from 'react-native';

declare function require(name: string): any;
import { measureAsync, measureMark } from '../observability/measure';
import { getVoiceCapability, summarizeVoiceCapability } from './voiceHealth';

type SpeechCallbacks = {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
  onStatus?: (status: string) => void;
};

type VoiceModule = any;
type SpeechProvider = 'native' | 'web' | 'none';

type Diagnostics = {
  available: boolean;
  provider: SpeechProvider;
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
  lifecycleNoise: number;
  permission: 'unknown' | 'granted' | 'denied' | 'unavailable';
  volumeEvents: number;
  lastVolumeAt: string | null;
  lastVoiceActivityAt: string | null;
  adaptiveWatchdog: boolean;
  watchdogIntervalMs: number;
  quietTicks: number;
  vadFloor: number;
};

type StartOptions = { watchdogEnabled?: boolean; adaptiveWatchdog?: boolean };

const INITIAL_BACKOFF_MS = 450;
const MAX_BACKOFF_MS = 4000;
const WATCHDOG_INTERVAL_MS = 15_000;
const LOW_POWER_WATCHDOG_INTERVAL_MS = 35_000;
const STALE_ENGINE_MS = 90_000;
const QUIET_STALE_ENGINE_MS = 150_000;
const ANDROID_COMPLETE_SILENCE_MS = Number(process.env?.EXPO_PUBLIC_AGA_SPEECH_COMPLETE_SILENCE_MS || 900);
const ANDROID_POSSIBLE_SILENCE_MS = Number(process.env?.EXPO_PUBLIC_AGA_SPEECH_POSSIBLE_SILENCE_MS || 550);
const PARTIAL_THROTTLE_MS = 140;
const WEB_LIFECYCLE_NOISE_RE = /^(no-speech|aborted)$/i;

async function importVoice(): Promise<VoiceModule | null> {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-voice/voice');
    const voice = mod?.default ?? mod;
    return voice && typeof voice === 'object' ? voice : null;
  } catch {
    return null;
  }
}

function getWebSpeechCtor(): any | null {
  const root: any = globalThis as any;
  // Web, PWA, Android WebView, and some kiosk shells expose browser SpeechRecognition
  // even when React Native's Platform.OS is not exactly 'web'. Prefer it as a
  // fallback when the native @react-native-voice module is missing.
  return root.SpeechRecognition ?? root.webkitSpeechRecognition ?? null;
}

function doubleBackoff(current: number) {
  return Math.min(MAX_BACKOFF_MS, Math.max(INITIAL_BACKOFF_MS, current * 2));
}

function isPermanentNativeStartFailure(message: string) {
  return /startSpeech|NativeModule|native module|not available|not installed|undefined/i.test(message);
}

function isPermanentWebFailure(reason: string) {
  return /not-allowed|service-not-allowed|permission|denied|unsupported/i.test(reason);
}

function isWebLifecycleNoise(reason: string) {
  return WEB_LIFECYCLE_NOISE_RE.test(reason.trim());
}


async function requestAndroidRecordAudioPermission(callbacks: SpeechCallbacks): Promise<'granted' | 'denied' | 'unavailable'> {
  if (Platform.OS !== 'android') return 'granted';
  try {
    const permission = PermissionsAndroid?.PERMISSIONS?.RECORD_AUDIO;
    if (!permission || typeof PermissionsAndroid.request !== 'function') return 'unavailable';
    const alreadyGranted = typeof PermissionsAndroid.check === 'function'
      ? await PermissionsAndroid.check(permission)
      : false;
    if (alreadyGranted) return 'granted';
    callbacks.onStatus?.('requesting microphone permission');
    const result = await PermissionsAndroid.request(permission, {
      title: 'AGA microphone access',
      message: 'AGA needs the microphone to locally listen for the wake phrase.',
      buttonPositive: 'Allow',
      buttonNegative: 'Deny',
    });
    return result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
  } catch (error) {
    callbacks.onError?.(`microphone permission check failed: ${error instanceof Error ? error.message : String(error)}`);
    return 'unavailable';
  }
}

function firstTranscript(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).find(Boolean) ?? '';
  }
  return String(value ?? '').trim();
}

export class NativeSpeechLoop {
  private callbacks: SpeechCallbacks;
  private locale: string;
  private voice: VoiceModule | null = null;
  private webRecognition: any | null = null;
  private destroyed = false;
  private restarting = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogEnabled = true;
  private lastFinalFingerprint = '';
  private lastPartialEmitAt = 0;
  diagnostics: Diagnostics = {
    available: false,
    provider: 'none',
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
    lifecycleNoise: 0,
    permission: Platform.OS === 'android' ? 'unknown' : 'granted',
    volumeEvents: 0,
    lastVolumeAt: null,
    lastVoiceActivityAt: null,
    adaptiveWatchdog: true,
    watchdogIntervalMs: WATCHDOG_INTERVAL_MS,
    quietTicks: 0,
    vadFloor: 0,
  };

  constructor(callbacks: SpeechCallbacks, locale = 'en-US') {
    this.callbacks = callbacks;
    this.locale = locale;
  }

  updateCallbacks(callbacks: SpeechCallbacks) {
    this.callbacks = callbacks;
  }

  getDiagnostics() {
    return { ...this.diagnostics, capability: getVoiceCapability() };
  }

  async start(options: StartOptions = {}) {
    return measureAsync('voice.loop.start', async () => {
      this.destroyed = false;
      this.watchdogEnabled = options.watchdogEnabled !== false;
      this.diagnostics.adaptiveWatchdog = options.adaptiveWatchdog !== false;
      this.diagnostics.watchdogIntervalMs = this.diagnostics.adaptiveWatchdog ? LOW_POWER_WATCHDOG_INTERVAL_MS : WATCHDOG_INTERVAL_MS;
      const capability = getVoiceCapability();
      measureMark('voice.capability', capability as any);
      this.callbacks.onStatus?.(summarizeVoiceCapability(capability));

      if (Platform.OS === 'web') {
        await this.startWebSpeech();
        return;
      }

      const permission = await requestAndroidRecordAudioPermission(this.callbacks);
      this.diagnostics.permission = permission;
      measureMark('voice.permission', { platform: Platform.OS, permission });
      if (permission === 'denied') {
        const message = 'Microphone permission denied. Enable microphone permission for AGA in Android app settings.';
        this.diagnostics.provider = 'none';
        this.diagnostics.available = false;
        this.diagnostics.lastError = message;
        this.callbacks.onError?.(message);
        return;
      }

      this.voice = await importVoice();
      if (!this.voice && getWebSpeechCtor()) {
        this.callbacks.onStatus?.('native speech missing; using browser speech fallback');
        measureMark('voice.native.missing_web_fallback');
        await this.startWebSpeech();
        return;
      }

      this.diagnostics.provider = this.voice ? 'native' : 'none';
      this.diagnostics.available = !!this.voice;
      if (!this.voice) {
        const message = '@react-native-voice/voice is not available in this build and browser speech fallback is unavailable.';
        this.diagnostics.lastError = message;
        this.callbacks.onStatus?.('wake standby: voice module missing');
        return;
      }

      if (typeof this.voice.start !== 'function') {
        const message = '@react-native-voice/voice loaded, but Voice.start is missing.';
        this.diagnostics.available = false;
        this.diagnostics.lastError = message;
        this.callbacks.onStatus?.('voice unavailable: Voice.start missing');
        return;
      }

      this.installNativeHandlers();
      this.startWatchdog();
      await this.safeStart(false, 'initial');
    }, { platform: Platform.OS, locale: this.locale });
  }

  private installNativeHandlers() {
    if (!this.voice) return;

    this.voice.onSpeechRecognized = () => {
      this.callbacks.onStatus?.('recognized:native');
      measureMark('voice.native.onSpeechRecognized');
    };
    this.voice.onSpeechStart = () => {
      this.diagnostics.listening = true;
      this.diagnostics.lastVoiceActivityAt = new Date().toISOString();
      this.callbacks.onStatus?.('listening:native');
      measureMark('voice.native.onSpeechStart');
    };
    this.voice.onSpeechEnd = () => {
      this.diagnostics.listening = false;
      this.callbacks.onStatus?.('arming:speech_end');
      measureMark('voice.native.onSpeechEnd');
      this.scheduleRestart('speech_end');
    };
    this.voice.onSpeechVolumeChanged = (event: any) => {
      this.diagnostics.volumeEvents += 1;
      const now = Date.now();
      const raw = Number(event?.value ?? event?.volume ?? 0);
      const normalized = Number.isFinite(raw) ? Math.max(0, Math.min(1, (raw + 2) / 12)) : 0;
      this.diagnostics.vadFloor = this.diagnostics.vadFloor * 0.96 + normalized * 0.04;
      const active = normalized > Math.max(0.08, this.diagnostics.vadFloor + 0.06);
      if (active) {
        this.diagnostics.quietTicks = 0;
        this.diagnostics.lastVoiceActivityAt = new Date(now).toISOString();
      }
      const last = this.diagnostics.lastVolumeAt ? new Date(this.diagnostics.lastVolumeAt).getTime() : 0;
      this.diagnostics.lastVolumeAt = new Date(now).toISOString();
      if (now - last > 2500) {
        const value = String(event?.value ?? event?.volume ?? '').slice(0, 12);
        this.callbacks.onStatus?.(value ? `listening:native volume ${value}` : 'listening:native audio');
      }
    };
    this.voice.onSpeechPartialResults = (event: any) => {
      const text = firstTranscript(event?.value);
      this.diagnostics.lastPartialAt = new Date().toISOString();
      this.diagnostics.lastVoiceActivityAt = this.diagnostics.lastPartialAt;
      this.diagnostics.lastError = null;
      if (text) {
        const now = Date.now();
        if (now - this.lastPartialEmitAt >= PARTIAL_THROTTLE_MS) {
          this.lastPartialEmitAt = now;
          this.callbacks.onPartial?.(text);
        }
      }
    };
    this.voice.onSpeechResults = (event: any) => {
      const text = firstTranscript(event?.value);
      if (!text) return;
      const fingerprint = `${text.toLowerCase()}::${Math.floor(Date.now() / 1200)}`;
      if (fingerprint === this.lastFinalFingerprint) return;
      this.lastFinalFingerprint = fingerprint;
      this.diagnostics.lastFinal = text;
      this.diagnostics.lastVoiceActivityAt = new Date().toISOString();
      this.callbacks.onFinal?.(text);
      measureMark('voice.native.final', { chars: text.length });
      this.scheduleRestart('result');
    };
    this.voice.onSpeechError = (event: any) => {
      const message = String(event?.error?.message || event?.error?.code || 'Speech recognition error.');
      this.diagnostics.lastError = message;
      this.diagnostics.listening = false;
      this.callbacks.onError?.(message);
      measureMark('voice.native.error', { message });
      if (!isPermanentNativeStartFailure(message)) this.scheduleRestart('error');
    };
  }

  private async startWebSpeech() {
    return measureAsync('voice.web.start', async () => {
      const SpeechCtor = getWebSpeechCtor();
      this.diagnostics.provider = SpeechCtor ? 'web' : 'none';
      this.diagnostics.available = !!SpeechCtor;

      if (!SpeechCtor) {
        const message = 'Speech recognition is not available in this runtime. Rebuild the APK with @react-native-voice/voice, or run the web/PWA build in a browser that supports SpeechRecognition.';
        this.diagnostics.lastError = message;
        this.callbacks.onStatus?.('wake standby: speech recognition unavailable');
        return;
      }

      const recognition = new SpeechCtor();
      recognition.lang = this.locale;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 3;

      recognition.onstart = () => {
        this.diagnostics.listening = true;
        this.diagnostics.lastStartedAt = new Date().toISOString();
        this.diagnostics.lastVoiceActivityAt = this.diagnostics.lastStartedAt;
        this.diagnostics.lastError = null;
        this.callbacks.onStatus?.('listening:web');
        measureMark('voice.web.onstart');
      };

      recognition.onresult = (event: any) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex ?? 0; i < event.results.length; i += 1) {
          const result = event.results[i];
          const transcript = String(result?.[0]?.transcript ?? '').trim();
          if (!transcript) continue;
          if (result.isFinal) final += transcript;
          else interim += transcript;
        }
        if (interim) {
          this.diagnostics.lastPartialAt = new Date().toISOString();
          this.diagnostics.lastVoiceActivityAt = this.diagnostics.lastPartialAt;
          this.callbacks.onPartial?.(interim);
        }
        if (final) {
          const fingerprint = `${final.toLowerCase()}::${Math.floor(Date.now() / 1200)}`;
          if (fingerprint !== this.lastFinalFingerprint) {
            this.lastFinalFingerprint = fingerprint;
            this.diagnostics.lastFinal = final;
            this.callbacks.onFinal?.(final);
            measureMark('voice.web.final', { chars: final.length });
          }
        }
      };

      recognition.onerror = (event: any) => {
        const message = String(event?.error || event?.message || 'web speech recognition error');
        this.diagnostics.listening = false;

        if (isWebLifecycleNoise(message)) {
          this.diagnostics.lifecycleNoise += 1;
          this.diagnostics.lastError = null;
          this.callbacks.onStatus?.(`arming:web_${message}`);
          measureMark('voice.web.lifecycle', { message, count: this.diagnostics.lifecycleNoise });
          this.scheduleRestart(`web_${message}`);
          return;
        }

        this.diagnostics.lastError = message;
        this.callbacks.onError?.(message);
        measureMark('voice.web.error', { message });
        if (!isPermanentWebFailure(message)) this.scheduleRestart(`web_error:${message}`);
      };

      recognition.onend = () => {
        this.diagnostics.listening = false;
        this.callbacks.onStatus?.('arming:web_end');
        measureMark('voice.web.onend');
        this.scheduleRestart('web_end');
      };

      this.webRecognition = recognition;
      this.startWatchdog();
      await this.safeStart(false, 'web_initial');
    }, { locale: this.locale });
  }

  private startWatchdog() {
    if (!this.watchdogEnabled || this.watchdogTimer) return;
    const interval = this.diagnostics.adaptiveWatchdog ? LOW_POWER_WATCHDOG_INTERVAL_MS : WATCHDOG_INTERVAL_MS;
    this.diagnostics.watchdogIntervalMs = interval;
    this.watchdogTimer = setInterval(() => {
      if (this.destroyed || (!this.voice && !this.webRecognition)) return;
      this.diagnostics.watchdogTicks += 1;
      const lastActivity = this.diagnostics.lastVoiceActivityAt || this.diagnostics.lastPartialAt || this.diagnostics.lastStartedAt;
      const staleFor = lastActivity ? Date.now() - new Date(lastActivity).getTime() : Number.POSITIVE_INFINITY;
      if (this.diagnostics.adaptiveWatchdog && this.diagnostics.listening && staleFor < QUIET_STALE_ENGINE_MS) {
        this.diagnostics.quietTicks += 1;
        return;
      }
      if (!this.diagnostics.listening || staleFor > (this.diagnostics.adaptiveWatchdog ? QUIET_STALE_ENGINE_MS : STALE_ENGINE_MS)) {
        this.scheduleRestart(staleFor > STALE_ENGINE_MS ? 'watchdog_stale' : 'watchdog_not_listening');
      }
    }, interval);
  }

  private clearWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  private scheduleRestart(reason: string) {
    if (this.destroyed || this.restarting || this.restartTimer || (!this.voice && !this.webRecognition)) return;
    this.diagnostics.restartPending = true;
    this.diagnostics.lastRestartReason = reason;
    const delay = this.diagnostics.restartBackoffMs;
    this.callbacks.onStatus?.(`arming:${reason}`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.diagnostics.restartPending = false;
      void this.safeStart(true, reason);
    }, delay);
  }

  private reportTeardownError(label: string, error: unknown) {
    this.diagnostics.teardownErrors += 1;
    measureMark('voice.teardown.error', { label, error: error instanceof Error ? error.message : String(error ?? '') });
  }

  private async safeCancelOrStop(method: 'cancel' | 'stop') {
    try {
      if (this.webRecognition) {
        if (method === 'stop') this.webRecognition.stop?.();
        else this.webRecognition.abort?.();
        return;
      }
      await this.voice?.[method]?.();
    } catch (error) {
      this.reportTeardownError(`voice.${method}`, error);
    }
  }

  private async safeStart(isRestart: boolean, reason: string) {
    return measureAsync('voice.safeStart', async () => {
      if (this.destroyed || (!this.voice && !this.webRecognition)) return;
      this.restarting = true;
      try {
        if (isRestart) {
          await this.safeCancelOrStop('cancel');
          await this.safeCancelOrStop('stop');
          this.diagnostics.restarts += 1;
        }
        this.diagnostics.lastStartedAt = new Date().toISOString();
        this.diagnostics.lastRestartReason = isRestart ? reason : null;

        if (this.webRecognition) this.webRecognition.start();
        else {
          const startOptions = Platform.OS === 'android' ? {
            EXTRA_LANGUAGE_MODEL: 'LANGUAGE_MODEL_FREE_FORM',
            EXTRA_PARTIAL_RESULTS: true,
            REQUEST_PERMISSIONS_AUTO: true,
            EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: ANDROID_COMPLETE_SILENCE_MS,
            EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: ANDROID_POSSIBLE_SILENCE_MS,
          } : undefined;
          await this.voice.start(this.locale, startOptions);
        }

        this.diagnostics.listening = true;
        this.diagnostics.lastError = null;
        this.diagnostics.restartBackoffMs = INITIAL_BACKOFF_MS;
        this.callbacks.onStatus?.(isRestart ? `restarted:${reason}` : 'started');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not start speech recognition.';
        this.diagnostics.lastError = message;
        this.diagnostics.listening = false;
        this.diagnostics.restartBackoffMs = doubleBackoff(this.diagnostics.restartBackoffMs);
        const permanent = this.webRecognition ? isPermanentWebFailure(message) : isPermanentNativeStartFailure(message);
        const userMessage = permanent ? `Voice recognition is unavailable in this runtime: ${message}` : message;
        if (isWebLifecycleNoise(message)) this.callbacks.onStatus?.(`arming:${message}`);
        else this.callbacks.onError?.(userMessage);
        measureMark('voice.safeStart.error', { reason, permanent, message });
        if (!permanent) this.scheduleRestart(`start_failed:${reason}`);
      } finally {
        this.restarting = false;
      }
    }, { provider: this.diagnostics.provider, reason, isRestart });
  }

  async stop(reason = 'manual_stop') {
    return measureAsync('voice.loop.stop', async () => {
      if (this.restartTimer) clearTimeout(this.restartTimer);
      this.restartTimer = null;
      this.diagnostics.restartPending = false;
      this.diagnostics.lastRestartReason = reason;
      await this.safeCancelOrStop('cancel');
      await this.safeCancelOrStop('stop');
      this.diagnostics.listening = false;
      this.callbacks.onStatus?.(`stopped:${reason}`);
    }, { reason });
  }

  async destroy() {
    return measureAsync('voice.loop.destroy', async () => {
      this.destroyed = true;
      if (this.restartTimer) clearTimeout(this.restartTimer);
      this.restartTimer = null;
      this.diagnostics.restartPending = false;
      this.clearWatchdog();
      try { await this.voice?.destroy?.(); } catch (error) { this.reportTeardownError('voice.destroy', error); }
      try { this.voice?.removeAllListeners?.(); } catch (error) { this.reportTeardownError('voice.removeAllListeners', error); }
      try { this.webRecognition?.abort?.(); } catch (error) { this.reportTeardownError('webRecognition.abort', error); }
      this.webRecognition = null;
      this.voice = null;
      this.diagnostics.listening = false;
    });
  }
}
