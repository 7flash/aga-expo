import { hasWakeWord, parseVoiceCommand } from './actions';
import type { AgaAction, AgaMode } from './turn';
import { shouldAcceptFinalSpeech } from './turnGate';
import { askBrain, translatePhrase } from '../backend/brain';
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
} from '../db/localStore';
import { searchYouTube, type YouTubeResult } from '../media/youtube';
import { scheduleAgaReminderNotification, ensureNotificationPermission } from '../notifications/localNotifications';
import { NativeSpeechLoop } from '../voice/nativeSpeech';
import { speak, stopSpeaking } from '../voice/tts';

type ActiveMedia = (YouTubeResult & { type: 'youtube'; state: 'loading' | 'playing' | 'paused' | 'stopped' }) | null;

export type AgaBrainSnapshot = {
  ready: boolean;
  mode: AgaMode;
  interim: string;
  messages: Array<{ role: string; content: string; createdAt?: string }>;
  reminders: Reminder[];
  activeMedia: ActiveMedia;
  mediaCommand: 'pause' | 'resume' | 'stop' | null;
  speechStatus: string;
  error: string | null;
};

type Listener = (snapshot: AgaBrainSnapshot) => void;

const initialPrefs: Preferences = {
  wakePhrase: 'hey aga',
  persona: 'warm',
  voiceLocale: 'en-US',
  openaiApiKey: process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? '',
  geminiApiKey: process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '',
  brainMode: ((process.env.EXPO_PUBLIC_AGA_BRAIN_MODE as Preferences['brainMode']) || 'openai') as Preferences['brainMode'],
  translateTarget: null,
  showDiagnostics: false,
  proactiveReminders: true,
};

export class CognitiveEngine {
  private listeners = new Set<Listener>();
  private loop: NativeSpeechLoop | null = null;
  private prefs: Preferences = initialPrefs;
  private processing = false;
  private proactiveBusy = false;
  private activeUntil = 0;
  private proactiveTimer: ReturnType<typeof setInterval> | null = null;
  private mode: AgaMode = 'sleeping';
  private snapshot: AgaBrainSnapshot = {
    ready: false,
    mode: 'sleeping',
    interim: '',
    messages: [],
    reminders: [],
    activeMedia: null,
    mediaCommand: null,
    speechStatus: 'starting',
    error: null,
  };

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  private publish(patch: Partial<AgaBrainSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  private setMode(mode: AgaMode) {
    this.mode = mode;
    this.publish({ mode });
  }

  async start() {
    await initializeLocalStore();
    this.prefs = await loadPreferences();
    await this.refresh();
    this.publish({ ready: true });
    await this.startSpeechLoop();
    this.startDreamLoop();
  }

  async stop() {
    if (this.proactiveTimer) clearInterval(this.proactiveTimer);
    this.proactiveTimer = null;
    await this.loop?.destroy?.();
    this.loop = null;
  }

  async replay(text: string) {
    await this.say(text);
  }

  async closeMedia() {
    this.publish({ mediaCommand: 'stop', activeMedia: this.snapshot.activeMedia ? { ...this.snapshot.activeMedia, state: 'stopped' } : null });
    setTimeout(() => this.publish({ activeMedia: null, mediaCommand: null }), 250);
    this.setMode('sleeping');
  }

  onMediaEvent(raw: string) {
    let type = raw;
    try { type = JSON.parse(raw)?.type ?? raw; } catch { /* keep raw */ }
    const current = this.snapshot.activeMedia;
    if (!current) return;
    const state = type.includes('paused') ? 'paused' : type.includes('playing') ? 'playing' : type.includes('ended') ? 'stopped' : current.state;
    this.publish({ activeMedia: { ...current, state }, mediaCommand: null });
    void logEvent('media.youtube', String(type));
  }

  private async refresh() {
    const [messages, reminders] = await Promise.all([listMessages(16), listPendingReminders(6)]);
    this.publish({ messages, reminders });
  }

  private async startSpeechLoop() {
    await this.loop?.destroy?.();
    const loop = new NativeSpeechLoop({
      onPartial: (text) => this.publish({ interim: text, error: null }),
      onFinal: (text) => { void this.handleRecognizedText(text); },
      onError: (message) => {
        this.publish({ speechStatus: `mic error: ${message}`, error: message });
        void logEvent('voice.error', message);
      },
      onStatus: (status) => this.publish({ speechStatus: status }),
    }, this.prefs.voiceLocale || 'en-US');
    this.loop = loop;
    await loop.start({ watchdogEnabled: true });
    this.setMode('listening');
  }

  private startDreamLoop() {
    if (this.proactiveTimer) clearInterval(this.proactiveTimer);
    this.proactiveTimer = setInterval(() => {
      if (!this.prefs.proactiveReminders || this.proactiveBusy || this.processing) return;
      this.proactiveBusy = true;
      void (async () => {
        try {
          const due = await drainDueReminders();
          for (const reminder of due) {
            await logEvent('reminder.due', reminder.text);
            await this.say(`Reminder: ${reminder.text}`);
          }
          if (due.length) await this.refresh();
          if (this.mode === 'sleeping' || this.mode === 'listening') await compactEventLogIfIdle();
        } finally {
          this.proactiveBusy = false;
        }
      })();
    }, 15_000);
  }

  private async say(text: string) {
    const clean = text.trim();
    if (!clean) return;
    this.setMode('speaking');
    await addMessage('assistant', clean);
    await this.refresh();
    await speak(clean, this.prefs, {
      onDone: () => this.setMode(this.snapshot.activeMedia ? 'media' : this.prefs.translateTarget ? 'translating' : 'listening'),
    });
  }

  private async applyAction(action: AgaAction) {
    switch (action.type) {
      case 'speak':
        await this.say(action.text);
        return;
      case 'stop_speaking':
        await stopSpeaking();
        this.setMode('listening');
        await logEvent('voice.stop', 'Stopped TTS by command');
        return;
      case 'remember':
        await addMemory(action.text);
        await logEvent('memory.add', action.text);
        await this.refresh();
        return;
      case 'recall': {
        const found = await searchMemories(action.query, 6);
        const speech = found.length
          ? `I remember ${found.map((m) => m.text).join('; ')}`
          : action.query
            ? `I do not have a memory about ${action.query} yet.`
            : 'I do not have saved memories yet.';
        await this.say(speech);
        return;
      }
      case 'set_persona':
        this.prefs = await savePreferences({ persona: action.persona });
        await logEvent('prefs.persona', action.persona);
        return;
      case 'set_wake_phrase':
        this.prefs = await savePreferences({ wakePhrase: action.phrase.toLowerCase() });
        await logEvent('prefs.wakePhrase', action.phrase);
        return;
      case 'translate_start':
        this.prefs = await savePreferences({ translateTarget: action.target });
        this.setMode('translating');
        await logEvent('translate.start', action.target);
        return;
      case 'translate_stop':
        this.prefs = await savePreferences({ translateTarget: null });
        this.setMode('listening');
        await logEvent('translate.stop');
        return;
      case 'show_diagnostics':
        this.prefs = await savePreferences({ showDiagnostics: !this.prefs.showDiagnostics });
        await this.refresh();
        return;
      case 'add_reminder': {
        const reminder = await addReminder(action.text, action.dueAt);
        const notificationId = await scheduleAgaReminderNotification({
          body: action.text,
          dueAt: action.dueAt,
          data: { reminderId: reminder.id, kind: 'aga.reminder' },
        }).catch(() => null);
        await logEvent('reminder.add', `${reminder.text} @ ${reminder.dueAt}${notificationId ? ` notification=${notificationId}` : ''}`);
        await this.refresh();
        await this.say(`Okay, I will remind you about ${action.text}.`);
        return;
      }
      case 'request_notifications': {
        const granted = await ensureNotificationPermission();
        await this.say(granted ? 'Notifications are ready.' : 'Notifications are not enabled yet.');
        return;
      }
      case 'list_reminders': {
        const pending = await listPendingReminders(6);
        await this.say(pending.length ? `You have ${pending.length} reminder${pending.length === 1 ? '' : 's'}: ${pending.map((item) => item.text).join('; ')}.` : 'You have no pending reminders.');
        await this.refresh();
        return;
      }
      case 'clear_reminders':
        await clearReminders();
        await logEvent('reminder.clear');
        await this.refresh();
        await this.say('I cleared your reminders.');
        return;
      case 'youtube_play': {
        this.setMode('media');
        this.publish({ activeMedia: { type: 'youtube', videoId: '', title: action.query, url: '', thumbnailUrl: null, state: 'loading' } });
        const result = await searchYouTube(action.query);
        if (!result.videoId) {
          await this.say(`I found YouTube results for ${action.query}, but could not auto-open a video.`);
          return;
        }
        this.publish({ activeMedia: { ...result, type: 'youtube', state: 'playing' }, mediaCommand: null });
        await logEvent('youtube.play', `${result.title} ${result.url}`);
        await this.say(`Playing ${result.title}.`);
        this.setMode('media');
        return;
      }
      case 'media_pause':
        this.publish({ mediaCommand: 'pause', activeMedia: this.snapshot.activeMedia ? { ...this.snapshot.activeMedia, state: 'paused' } : null });
        await logEvent('media.pause');
        return;
      case 'media_resume':
        this.publish({ mediaCommand: 'resume', activeMedia: this.snapshot.activeMedia ? { ...this.snapshot.activeMedia, state: 'playing' } : null });
        await logEvent('media.resume');
        return;
      case 'media_stop':
        await this.closeMedia();
        await logEvent('media.stop');
        return;
      case 'test_voice':
        await this.say('My voice is working. I am listening from the APK, without localhost.');
        return;
      case 'status': {
        const diag = await getDiagnostics();
        await this.say(`I am running locally. Speech status is ${this.snapshot.speechStatus}. I have ${diag.messages} messages, ${diag.memories} memories, and ${diag.pendingReminders} pending reminders.`);
        await this.refresh();
        return;
      }
      case 'open_settings':
        await this.say('Open settings with the small gear, or say what you want me to change.');
        return;
      case 'reset_conversation':
        await clearMessages();
        await this.refresh();
        return;
      case 'chat':
        return;
    }
  }

  private async handleRecognizedText(recognized: string) {
    const text = recognized.trim();
    if (!text) return;

    const gate = shouldAcceptFinalSpeech(this.mode, text, this.processing);
    if (gate.isBargeIn) {
      await stopSpeaking();
      this.processing = false;
      this.setMode('listening');
      await logEvent('voice.barge_in', text);
      await this.refresh();
      return;
    }
    if (!gate.accept) {
      this.publish({ interim: text });
      await logEvent('voice.ignored', `${gate.reason}: ${text.slice(0, 180)}`);
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
    this.setMode(this.prefs.translateTarget ? 'translating' : 'thinking');
    this.publish({ interim: text, error: null });
    await addMessage('user', text);
    await logEvent('voice.final', text);
    await this.refresh();

    try {
      if (this.prefs.translateTarget && !woke) {
        const translated = await translatePhrase(text, this.prefs.translateTarget, this.prefs);
        await this.say(translated);
        return;
      }

      const parsed = parseVoiceCommand(text, this.prefs.wakePhrase);
      for (const action of parsed.actions) {
        if (action.type !== 'chat') await this.applyAction(action);
      }

      const chatAction = parsed.actions.find((action) => action.type === 'chat');
      if (chatAction?.type === 'chat') {
        const [history, memories] = await Promise.all([listMessages(20), searchMemories(undefined, 8)]);
        const reply = await askBrain({ text: chatAction.text, prefs: this.prefs, history, memories });
        await this.say(reply);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'I hit a local error.';
      this.publish({ error: message });
      await logEvent('turn.error', message);
      await this.say(`I hit a small glitch, but I am still here. ${message}`);
    } finally {
      this.processing = false;
      await this.refresh();
      if (!this.snapshot.activeMedia && this.mode !== 'translating') this.setMode('listening');
    }
  }
}
