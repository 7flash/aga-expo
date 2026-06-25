import { Platform } from "react-native";

declare function require(name: string): any;
import { measureAsync, measureMark } from "../observability/measure";

type SpeechCallbacks = {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
  onStatus?: (status: string) => void;
};

type VoiceModule = any;

type SpeechProvider = "native" | "web" | "none";

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
};

type StartOptions = {
  watchdogEnabled?: boolean;
};

const INITIAL_BACKOFF_MS = 450;
const MAX_BACKOFF_MS = 4000;
const WATCHDOG_INTERVAL_MS = 15_000;
const STALE_ENGINE_MS = 90_000;

async function importVoice(): Promise<VoiceModule | null> {
  if (Platform.OS === "web") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("@react-native-voice/voice");
    const voice = mod?.default ?? mod;
    return voice && typeof voice === "object" ? voice : null;
  } catch {
    return null;
  }
}

function getWebSpeechCtor(): any | null {
  if (Platform.OS !== "web") return null;
  const root: any = globalThis as any;
  return root.SpeechRecognition ?? root.webkitSpeechRecognition ?? null;
}

function doubleBackoff(current: number) {
  return Math.min(MAX_BACKOFF_MS, Math.max(INITIAL_BACKOFF_MS, current * 2));
}

function isPermanentNativeStartFailure(message: string) {
  return /startSpeech|NativeModule|native module|not available|not installed|undefined/i.test(
    message,
  );
}

function isPermanentWebFailure(reason: string) {
  return /not-allowed|service-not-allowed|permission|denied|unsupported/i.test(
    reason,
  );
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
  private lastFinalFingerprint = "";
  diagnostics: Diagnostics = {
    available: false,
    provider: "none",
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

  constructor(callbacks: SpeechCallbacks, locale = "en-US") {
    this.callbacks = callbacks;
    this.locale = locale;
  }

  updateCallbacks(callbacks: SpeechCallbacks) {
    this.callbacks = callbacks;
  }

  async start(options: StartOptions = {}) {
    return measureAsync(
      "voice.loop.start",
      async () => {
        this.destroyed = false;
        this.watchdogEnabled = options.watchdogEnabled !== false;

        if (Platform.OS === "web") {
          await this.startWebSpeech();
          return;
        }

        this.voice = await importVoice();
        this.diagnostics.provider = this.voice ? "native" : "none";
        this.diagnostics.available = !!this.voice;
        if (!this.voice) {
          const message =
            "@react-native-voice/voice is not available in this build.";
          this.diagnostics.lastError = message;
          this.callbacks.onStatus?.("voice unavailable: native module missing");
          return;
        }

        if (typeof this.voice.start !== "function") {
          const message =
            "@react-native-voice/voice loaded, but Voice.start is missing.";
          this.diagnostics.available = false;
          this.diagnostics.lastError = message;
          this.callbacks.onStatus?.("voice unavailable: Voice.start missing");
          return;
        }

        this.installNativeHandlers();
        this.startWatchdog();
        await this.safeStart(false, "initial");
      },
      { platform: Platform.OS, locale: this.locale },
    );
  }

  private installNativeHandlers() {
    if (!this.voice) return;

    this.voice.onSpeechStart = () => {
      this.diagnostics.listening = true;
      this.callbacks.onStatus?.("listening");
      measureMark("voice.native.onSpeechStart");
    };
    this.voice.onSpeechEnd = () => {
      this.diagnostics.listening = false;
      this.callbacks.onStatus?.("speech ended; arming again");
      measureMark("voice.native.onSpeechEnd");
      this.scheduleRestart("speech_end");
    };
    this.voice.onSpeechPartialResults = (event: any) => {
      const text = event?.value?.[0] ?? "";
      this.diagnostics.lastPartialAt = new Date().toISOString();
      this.diagnostics.lastError = null;
      if (text) this.callbacks.onPartial?.(text);
    };
    this.voice.onSpeechResults = (event: any) => {
      const text = String(event?.value?.[0] ?? "").trim();
      if (!text) return;
      const fingerprint = `${text.toLowerCase()}::${Math.floor(Date.now() / 1200)}`;
      if (fingerprint === this.lastFinalFingerprint) return;
      this.lastFinalFingerprint = fingerprint;
      this.diagnostics.lastFinal = text;
      this.callbacks.onFinal?.(text);
      measureMark("voice.native.final", { chars: text.length });
      this.scheduleRestart("result");
    };
    this.voice.onSpeechError = (event: any) => {
      const message = String(
        event?.error?.message ||
          event?.error?.code ||
          "Speech recognition error.",
      );
      this.diagnostics.lastError = message;
      this.diagnostics.listening = false;
      this.callbacks.onError?.(message);
      measureMark("voice.native.error", { message });
      if (!isPermanentNativeStartFailure(message))
        this.scheduleRestart("error");
    };
  }

  private async startWebSpeech() {
    return measureAsync(
      "voice.web.start",
      async () => {
        const SpeechCtor = getWebSpeechCtor();
        this.diagnostics.provider = SpeechCtor ? "web" : "none";
        this.diagnostics.available = !!SpeechCtor;

        if (!SpeechCtor) {
          const message =
            "Browser speech recognition is not supported here. Use a native dev build/APK for always-on voice.";
          this.diagnostics.lastError = message;
          this.callbacks.onStatus?.(
            "voice unavailable: browser speech recognition unsupported",
          );
          return;
        }

        const recognition = new SpeechCtor();
        recognition.lang = this.locale;
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
          this.diagnostics.listening = true;
          this.diagnostics.lastStartedAt = new Date().toISOString();
          this.diagnostics.lastError = null;
          this.callbacks.onStatus?.("listening:web");
          measureMark("voice.web.onstart");
        };
        recognition.onresult = (event: any) => {
          let interim = "";
          let final = "";
          for (
            let i = event.resultIndex ?? 0;
            i < event.results.length;
            i += 1
          ) {
            const transcript = String(
              event.results[i]?.[0]?.transcript ?? "",
            ).trim();
            if (!transcript) continue;
            if (event.results[i].isFinal) final += transcript;
            else interim += transcript;
          }
          if (interim) {
            this.diagnostics.lastPartialAt = new Date().toISOString();
            this.callbacks.onPartial?.(interim);
          }
          if (final) {
            const fingerprint = `${final.toLowerCase()}::${Math.floor(Date.now() / 1200)}`;
            if (fingerprint !== this.lastFinalFingerprint) {
              this.lastFinalFingerprint = fingerprint;
              this.diagnostics.lastFinal = final;
              this.callbacks.onFinal?.(final);
              measureMark("voice.web.final", { chars: final.length });
            }
          }
        };
        recognition.onerror = (event: any) => {
          const message = String(
            event?.error || event?.message || "web speech recognition error",
          );
          this.diagnostics.lastError = message;
          this.diagnostics.listening = false;
          this.callbacks.onError?.(message);
          measureMark("voice.web.error", { message });
          if (!isPermanentWebFailure(message))
            this.scheduleRestart(`web_error:${message}`);
        };
        recognition.onend = () => {
          this.diagnostics.listening = false;
          this.callbacks.onStatus?.("speech ended; arming again");
          measureMark("voice.web.onend");
          this.scheduleRestart("web_end");
        };

        this.webRecognition = recognition;
        this.startWatchdog();
        await this.safeStart(false, "web_initial");
      },
      { locale: this.locale },
    );
  }

  private startWatchdog() {
    if (!this.watchdogEnabled || this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => {
      if (this.destroyed || (!this.voice && !this.webRecognition)) return;
      this.diagnostics.watchdogTicks += 1;

      const lastActivity =
        this.diagnostics.lastPartialAt || this.diagnostics.lastStartedAt;
      const staleFor = lastActivity
        ? Date.now() - new Date(lastActivity).getTime()
        : Number.POSITIVE_INFINITY;
      if (!this.diagnostics.listening || staleFor > STALE_ENGINE_MS) {
        this.scheduleRestart(
          staleFor > STALE_ENGINE_MS
            ? "watchdog_stale"
            : "watchdog_not_listening",
        );
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  private clearWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  private scheduleRestart(reason: string) {
    if (
      this.destroyed ||
      this.restarting ||
      this.restartTimer ||
      (!this.voice && !this.webRecognition)
    )
      return;
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
    measureMark("voice.teardown.error", {
      label,
      error: error instanceof Error ? error.message : String(error ?? ""),
    });
  }

  private async safeCancelOrStop(method: "cancel" | "stop") {
    try {
      if (this.webRecognition) {
        if (method === "stop") this.webRecognition.stop?.();
        else this.webRecognition.abort?.();
        return;
      }
      await this.voice?.[method]?.();
    } catch (error) {
      this.reportTeardownError(`voice.${method}`, error);
    }
  }

  private async safeStart(isRestart: boolean, reason: string) {
    return measureAsync(
      "voice.safeStart",
      async () => {
        if (this.destroyed || (!this.voice && !this.webRecognition)) return;
        this.restarting = true;
        try {
          if (isRestart) {
            await this.safeCancelOrStop("cancel");
            await this.safeCancelOrStop("stop");
            this.diagnostics.restarts += 1;
          }
          this.diagnostics.lastStartedAt = new Date().toISOString();
          this.diagnostics.lastRestartReason = isRestart ? reason : null;

          if (this.webRecognition) this.webRecognition.start();
          else await this.voice.start(this.locale);

          this.diagnostics.listening = true;
          this.diagnostics.lastError = null;
          this.diagnostics.restartBackoffMs = INITIAL_BACKOFF_MS;
          this.callbacks.onStatus?.(
            isRestart ? `restarted:${reason}` : "started",
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Could not start speech recognition.";
          this.diagnostics.lastError = message;
          this.diagnostics.listening = false;
          this.diagnostics.restartBackoffMs = doubleBackoff(
            this.diagnostics.restartBackoffMs,
          );

          const permanent = this.webRecognition
            ? isPermanentWebFailure(message)
            : isPermanentNativeStartFailure(message);
          const userMessage = permanent
            ? `Voice recognition is unavailable in this runtime: ${message}`
            : message;
          this.callbacks.onError?.(userMessage);
          measureMark("voice.safeStart.error", { reason, permanent, message });
          if (!permanent) this.scheduleRestart(`start_failed:${reason}`);
        } finally {
          this.restarting = false;
        }
      },
      { provider: this.diagnostics.provider, reason, isRestart },
    );
  }

  async stop(reason = "manual_stop") {
    return measureAsync(
      "voice.loop.stop",
      async () => {
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = null;
        this.diagnostics.restartPending = false;
        this.diagnostics.lastRestartReason = reason;
        await this.safeCancelOrStop("cancel");
        await this.safeCancelOrStop("stop");
        this.diagnostics.listening = false;
        this.callbacks.onStatus?.(`stopped:${reason}`);
      },
      { reason },
    );
  }

  async destroy() {
    return measureAsync("voice.loop.destroy", async () => {
      this.destroyed = true;
      if (this.restartTimer) clearTimeout(this.restartTimer);
      this.restartTimer = null;
      this.diagnostics.restartPending = false;
      this.clearWatchdog();
      try {
        await this.voice?.destroy?.();
      } catch (error) {
        this.reportTeardownError("voice.destroy", error);
      }
      try {
        this.voice?.removeAllListeners?.();
      } catch (error) {
        this.reportTeardownError("voice.removeAllListeners", error);
      }
      try {
        this.webRecognition?.abort?.();
      } catch (error) {
        this.reportTeardownError("webRecognition.abort", error);
      }
      this.webRecognition = null;
      this.voice = null;
      this.diagnostics.listening = false;
    });
  }
}
