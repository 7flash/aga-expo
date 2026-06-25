import { hasWakeWord, parseVoiceCommand } from "./actions";
import type { AgaAction, AgaMode } from "./turn";
import { shouldAcceptFinalSpeech } from "./turnGate";
import { FinalSpeechDeduper, SerialTurnQueue } from "./turnQueue";
import { askBrain, translatePhrase } from "../backend/brain";
import {
  addMemory,
  addMessage,
  addReminder,
  clearMessages,
  clearReminders,
  compactEventLogIfIdle,
  drainDueReminders,
  getDiagnostics,
  initializeLocalStore,
  listMessages,
  listPendingReminders,
  loadPreferences,
  logEvent,
  savePreferences,
  searchMemories,
  type Preferences,
  type Reminder,
} from "../db/localStore";
import { searchYouTube, type YouTubeResult } from "../media/youtube";
import {
  cancelAllNotifications,
  configureNotificationHandler,
  ensureNotificationPermission,
  scheduleAgaReminderNotification,
} from "../notifications/localNotifications";
import { NativeSpeechLoop } from "../voice/nativeSpeech";
import { getTtsDiagnostics, isTtsAvailable, primeTts, speak, stopSpeaking } from "../voice/tts";
import {
  getRecentAgaMeasures,
  measureAsync,
  measureMark,
} from "../observability/measure";

type ActiveMedia =
  | (YouTubeResult & {
      type: "youtube";
      state: "loading" | "playing" | "paused" | "stopped";
    })
  | null;

export type AgaBrainSnapshot = {
  ready: boolean;
  mode: AgaMode;
  interim: string;
  messages: Array<{ role: string; content: string; createdAt?: string }>;
  reminders: Reminder[];
  activeMedia: ActiveMedia;
  mediaCommand: "pause" | "resume" | "stop" | null;
  speechStatus: string;
  error: string | null;
  lastMeasure?: string;
  ttsStatus?: string;
};

type Listener = (snapshot: AgaBrainSnapshot) => void;

const initialPrefs: Preferences = {
  wakePhrase: "hey aga",
  persona: "warm",
  voiceLocale: "en-US",
  openaiApiKey: process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? "",
  geminiApiKey: process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? "",
  brainMode: ((process.env
    .EXPO_PUBLIC_AGA_BRAIN_MODE as Preferences["brainMode"]) ||
    "openai") as Preferences["brainMode"],
  translateTarget: null,
  showDiagnostics: false,
  proactiveReminders: true,
};

export class CognitiveEngine {
  private listeners = new Set<Listener>();
  private loop: NativeSpeechLoop | null = null;
  private started = false;
  private stopped = false;
  private finalDeduper = new FinalSpeechDeduper();
  private turnQueue = new SerialTurnQueue();
  private prefs: Preferences = initialPrefs;
  private processing = false;
  private proactiveBusy = false;
  private activeUntil = 0;
  private proactiveTimer: ReturnType<typeof setInterval> | null = null;
  private mode: AgaMode = "sleeping";
  private snapshot: AgaBrainSnapshot = {
    ready: false,
    mode: "sleeping",
    interim: "",
    messages: [],
    reminders: [],
    activeMedia: null,
    mediaCommand: null,
    speechStatus: "starting",
    error: null,
    lastMeasure: undefined,
    ttsStatus: undefined,
  };

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  private publish(patch: Partial<AgaBrainSnapshot>) {
    const recentMeasures = getRecentAgaMeasures();
    const latestMeasure = recentMeasures[recentMeasures.length - 1];
    const tts = getTtsDiagnostics();
    this.snapshot = {
      ...this.snapshot,
      ...(latestMeasure
        ? {
            lastMeasure: `${latestMeasure.label} ${Math.round(latestMeasure.durationMs)}ms`,
          }
        : null),
      ttsStatus: `${tts.provider}${tts.available ? "" : ":unavailable"}${tts.unlocked ? ":unlocked" : ""}${tts.lastError ? ` — ${tts.lastError}` : ""}`,
      ...patch,
    };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  private setMode(mode: AgaMode) {
    this.mode = mode;
    this.publish({ mode });
  }

  async start() {
    return measureAsync(
      "engine.start",
      async () => {
        if (this.started) return;
        this.started = true;
        this.stopped = false;
        this.finalDeduper = new FinalSpeechDeduper();
        this.turnQueue = new SerialTurnQueue();
        try {
          configureNotificationHandler();
          await initializeLocalStore();
          this.prefs = await loadPreferences();
          await this.refresh();
          const ttsReady = await isTtsAvailable().catch(() => false);
          this.publish({
            ready: true,
            speechStatus: ttsReady
              ? "ready — tap avatar once if voice is silent"
              : "ready — voice output unavailable",
          });
          await this.startSpeechLoop();
          this.startDreamLoop();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "AGA failed to start.";
          this.publish({
            ready: true,
            mode: "recovering",
            speechStatus: "recovering",
            error: message,
          });
          await logEvent("engine.start.error", message).catch(() => undefined);
        }
      },
      { locale: this.prefs.voiceLocale },
    );
  }

  async stop() {
    return measureAsync("engine.stop", async () => {
      this.stopped = true;
      this.started = false;
      this.turnQueue.stop();
      if (this.proactiveTimer) clearInterval(this.proactiveTimer);
      this.proactiveTimer = null;
      await stopSpeaking().catch(() => undefined);
      await this.loop?.destroy?.();
      this.loop = null;
    });
  }

  async rearmMic() {
    return measureAsync("engine.rearmMic", async () => {
      this.finalDeduper.reset();
      const ttsReady = await primeTts(this.prefs.voiceLocale || "en-US").catch(() => false);
      this.publish({
        speechStatus: ttsReady
          ? "audio enabled; listening"
          : "audio still locked or unavailable; check browser/site sound",
      });
      await this.loop?.stop?.("manual_rearm").catch(() => undefined);
      await this.startSpeechLoop().catch((error) => {
        const message =
          error instanceof Error
            ? error.message
            : "Could not restart microphone.";
        this.publish({ error: message, speechStatus: "mic restart failed" });
      });
    });
  }

  async replay(text: string) {
    return measureAsync("engine.replay", async () => this.say(text), {
      chars: text.length,
    });
  }

  async closeMedia() {
    return measureAsync("engine.closeMedia", async () => {
      this.publish({
        mediaCommand: "stop",
        activeMedia: this.snapshot.activeMedia
          ? { ...this.snapshot.activeMedia, state: "stopped" }
          : null,
      });
      setTimeout(
        () => this.publish({ activeMedia: null, mediaCommand: null }),
        250,
      );
      this.setMode("sleeping");
    });
  }

  onMediaEvent(raw: string) {
    measureMark("engine.mediaEvent");
    let type = raw;
    try {
      type = JSON.parse(raw)?.type ?? raw;
    } catch {
      /* keep raw */
    }
    const current = this.snapshot.activeMedia;
    if (!current) return;
    const state = type.includes("paused")
      ? "paused"
      : type.includes("playing")
        ? "playing"
        : type.includes("ended")
          ? "stopped"
          : current.state;
    this.publish({ activeMedia: { ...current, state }, mediaCommand: null });
    void logEvent("media.youtube", String(type));
  }

  private async refresh() {
    return measureAsync("engine.refresh", async () => {
      const [messages, reminders] = await Promise.all([
        listMessages(16),
        listPendingReminders(6),
      ]);
      this.publish({ messages, reminders });
    });
  }

  private async startSpeechLoop() {
    return measureAsync(
      "engine.startSpeechLoop",
      async () => {
        await this.loop?.destroy?.();
        const loop = new NativeSpeechLoop(
          {
            onPartial: (text) => {
              measureMark("engine.voice.partial", { chars: text.length });
              this.publish({ interim: text, error: null });
            },
            onFinal: (text) => {
              measureMark("engine.voice.final.queued", { chars: text.length });
              this.turnQueue.enqueue(() => this.handleRecognizedText(text));
            },
            onError: (message) => {
              const unavailable =
                /unavailable|unsupported|not available|startSpeech|NativeModule/i.test(
                  message,
                );
              this.publish({
                speechStatus: unavailable ? message : `mic error: ${message}`,
                error: unavailable ? null : message,
              });
              void logEvent("voice.error", message);
            },
            onStatus: (status) => this.publish({ speechStatus: status }),
          },
          this.prefs.voiceLocale || "en-US",
        );
        this.loop = loop;
        await loop.start({ watchdogEnabled: true });
        this.setMode("listening");
      },
      { locale: this.prefs.voiceLocale || "en-US" },
    );
  }

  private startDreamLoop() {
    if (this.proactiveTimer) clearInterval(this.proactiveTimer);
    this.proactiveTimer = setInterval(() => {
      if (
        this.stopped ||
        !this.prefs.proactiveReminders ||
        this.proactiveBusy ||
        this.processing ||
        this.mode === "speaking"
      )
        return;
      this.proactiveBusy = true;
      void measureAsync("engine.dreamLoop.tick", async () => {
        try {
          const due = await drainDueReminders();
          for (const reminder of due) {
            await logEvent("reminder.due", reminder.text);
            await this.say(`Reminder: ${reminder.text}`);
          }
          if (due.length) await this.refresh();
          if (this.mode === "sleeping" || this.mode === "listening")
            await compactEventLogIfIdle();
        } finally {
          this.proactiveBusy = false;
        }
      });
    }, 15_000);
  }

  private async say(text: string) {
    return measureAsync(
      "engine.say",
      async () => {
        const clean = text.trim();
        if (!clean || this.stopped) return;
        this.setMode("speaking");
        await addMessage("assistant", clean);
        await this.refresh();

        // Speech recognition and speech synthesis fight each other on web and
        // can cause silent output or self-transcription. Fully suspend the mic
        // loop while AGA speaks, then restart it.
        const loopToRestore = this.loop;
        this.loop = null;
        await loopToRestore?.destroy?.().catch(() => undefined);

        const ok = await speak(clean, this.prefs, {
          onError: (message) => {
            this.publish({
              speechStatus: `tts issue: ${message}`,
              error: null,
            });
            void logEvent("tts.error", message);
          },
        });

        if (!ok) {
          this.publish({
            speechStatus: "voice output unavailable — tap avatar once or check browser sound",
          });
        }

        const nextMode = this.snapshot.activeMedia
          ? "media"
          : this.prefs.translateTarget
            ? "translating"
            : "listening";

        if (!this.stopped) {
          await this.startSpeechLoop().catch((error) => {
            const message = error instanceof Error ? error.message : "Could not restart speech recognition after speaking.";
            this.publish({ speechStatus: `mic restart failed after speech: ${message}` });
          });
        }
        this.setMode(nextMode);
      },
      { chars: text.length },
    );
  }

  private async applyAction(action: AgaAction) {
    return measureAsync(
      "engine.applyAction",
      async () => {
        switch (action.type) {
          case "speak":
            await this.say(action.text);
            return;
          case "stop_speaking":
            await stopSpeaking();
            if (this.snapshot.activeMedia?.state === "playing") {
              this.publish({
                mediaCommand: "pause",
                activeMedia: { ...this.snapshot.activeMedia, state: "paused" },
              });
            }
            this.setMode(this.snapshot.activeMedia ? "media" : "listening");
            await logEvent("voice.stop", "Stopped TTS by command");
            return;
          case "remember":
            await addMemory(action.text);
            await logEvent("memory.add", action.text);
            await this.refresh();
            return;
          case "recall": {
            const found = await searchMemories(action.query, 6);
            const speech = found.length
              ? `I remember ${found.map((m) => m.text).join("; ")}`
              : action.query
                ? `I do not have a memory about ${action.query} yet.`
                : "I do not have saved memories yet.";
            await this.say(speech);
            return;
          }
          case "set_persona":
            this.prefs = await savePreferences({ persona: action.persona });
            await logEvent("prefs.persona", action.persona);
            return;
          case "set_wake_phrase":
            this.prefs = await savePreferences({
              wakePhrase: action.phrase.toLowerCase(),
            });
            await logEvent("prefs.wakePhrase", action.phrase);
            return;
          case "translate_start":
            this.prefs = await savePreferences({
              translateTarget: action.target,
            });
            this.setMode("translating");
            await logEvent("translate.start", action.target);
            return;
          case "translate_stop":
            this.prefs = await savePreferences({ translateTarget: null });
            this.setMode("listening");
            await logEvent("translate.stop");
            return;
          case "show_diagnostics":
            this.prefs = await savePreferences({
              showDiagnostics: !this.prefs.showDiagnostics,
            });
            await this.refresh();
            return;
          case "add_reminder": {
            const reminder = await addReminder(action.text, action.dueAt);
            const notificationId = await scheduleAgaReminderNotification({
              body: action.text,
              dueAt: action.dueAt,
              data: { reminderId: reminder.id, kind: "aga.reminder" },
            }).catch(() => null);
            await logEvent(
              "reminder.add",
              `${reminder.text} @ ${reminder.dueAt}${notificationId ? ` notification=${notificationId}` : ""}`,
            );
            await this.refresh();
            await this.say(`Okay, I will remind you about ${action.text}.`);
            return;
          }
          case "request_notifications": {
            const permission = await ensureNotificationPermission();
            await this.say(
              permission === "granted"
                ? "Notifications are ready."
                : "Notifications are not enabled yet.",
            );
            return;
          }
          case "list_reminders": {
            const pending = await listPendingReminders(6);
            await this.say(
              pending.length
                ? `You have ${pending.length} reminder${pending.length === 1 ? "" : "s"}: ${pending.map((item) => item.text).join("; ")}.`
                : "You have no pending reminders.",
            );
            await this.refresh();
            return;
          }
          case "clear_reminders":
            await clearReminders();
            await cancelAllNotifications();
            await logEvent("reminder.clear");
            await this.refresh();
            await this.say("I cleared your reminders.");
            return;
          case "play_youtube":
          case "youtube_play": {
            this.setMode("media");
            this.publish({
              activeMedia: {
                type: "youtube",
                videoId: "",
                title: action.query,
                url: "",
                thumbnailUrl: null,
                state: "loading",
              },
            });
            const result = await searchYouTube(action.query);
            if (!result.videoId) {
              await this.say(
                `I found YouTube results for ${action.query}, but could not auto-open a video.`,
              );
              return;
            }
            this.publish({
              activeMedia: { ...result, type: "youtube", state: "playing" },
              mediaCommand: null,
            });
            await logEvent("youtube.play", `${result.title} ${result.url}`);
            await this.say(`Playing ${result.title}.`);
            this.setMode("media");
            return;
          }
          case "media_pause":
            this.publish({
              mediaCommand: "pause",
              activeMedia: this.snapshot.activeMedia
                ? { ...this.snapshot.activeMedia, state: "paused" }
                : null,
            });
            await logEvent("media.pause");
            return;
          case "media_resume":
            this.publish({
              mediaCommand: "resume",
              activeMedia: this.snapshot.activeMedia
                ? { ...this.snapshot.activeMedia, state: "playing" }
                : null,
            });
            await logEvent("media.resume");
            return;
          case "media_stop":
            await this.closeMedia();
            await logEvent("media.stop");
            return;
          case "test_voice":
            await this.say(
              "My voice is working. I am listening from the APK, without localhost.",
            );
            return;
          case "status": {
            const diag = await getDiagnostics();
            await this.say(
              `I am running locally. Speech status is ${this.snapshot.speechStatus}. I have ${diag.messages} messages, ${diag.memories} memories, and ${diag.pendingReminders} pending reminders.`,
            );
            await this.refresh();
            return;
          }
          case "open_settings":
            await this.say(
              "Open settings with the small gear, or say what you want me to change.",
            );
            return;
          case "reset_conversation":
            await clearMessages();
            await this.refresh();
            return;
          case "chat":
            return;
        }
      },
      { type: action.type },
    );
  }

  private async handleRecognizedText(recognized: string) {
    return measureAsync(
      "engine.handleRecognizedText",
      async () => {
        const text = recognized.trim();
        if (!text || this.stopped) return;
        if (this.finalDeduper.shouldDrop(text)) {
          await logEvent("voice.duplicate_final", text.slice(0, 180)).catch(
            () => undefined,
          );
          return;
        }

        const gate = shouldAcceptFinalSpeech(this.mode, text, this.processing);
        if (gate.isBargeIn) {
          await stopSpeaking();
          if (this.snapshot.activeMedia?.state === "playing") {
            this.publish({
              mediaCommand: "pause",
              activeMedia: { ...this.snapshot.activeMedia, state: "paused" },
            });
          }
          this.processing = false;
          this.setMode(this.snapshot.activeMedia ? "media" : "listening");
          await logEvent("voice.barge_in", text);
          await this.refresh();
          return;
        }
        if (!gate.accept) {
          this.publish({ interim: text });
          await logEvent(
            "voice.ignored",
            `${gate.reason}: ${text.slice(0, 180)}`,
          );
          return;
        }

        const now = Date.now();
        const woke = hasWakeWord(text, this.prefs.wakePhrase);
        const active = now < this.activeUntil;

        if (!woke && !active && !this.prefs.translateTarget) {
          this.publish({ interim: text });
          return;
        }

        this.activeUntil = Date.now() + 35_000;
        this.processing = true;
        this.setMode(this.prefs.translateTarget ? "translating" : "thinking");
        this.publish({ interim: text, error: null });
        await addMessage("user", text);
        await logEvent("voice.final", text);
        await this.refresh();

        try {
          if (this.prefs.translateTarget && !woke) {
            const translated = await translatePhrase(
              text,
              this.prefs.translateTarget,
              this.prefs,
            );
            await this.say(translated);
            return;
          }

          const parsed = parseVoiceCommand(text, this.prefs.wakePhrase);
          for (const action of parsed.actions) {
            if (action.type !== "chat") await this.applyAction(action);
          }

          const chatAction = parsed.actions.find(
            (action) => action.type === "chat",
          );
          if (chatAction?.type === "chat") {
            const [history, memories] = await Promise.all([
              listMessages(20),
              searchMemories(undefined, 8),
            ]);
            const reply = await askBrain({
              text: chatAction.text,
              prefs: this.prefs,
              history,
              memories,
            });
            await this.say(reply);
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "I hit a local error.";
          this.publish({ error: message });
          await logEvent("turn.error", message);
          await this.say("I hit a small glitch, but I am still here.");
        } finally {
          this.processing = false;
          await this.refresh();
          if (!this.snapshot.activeMedia && this.mode !== "translating")
            this.setMode("listening");
        }
      },
      { chars: recognized.length },
    );
  }
}
