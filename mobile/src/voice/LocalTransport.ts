import { hasWakeWord, parseVoiceCommand } from '../aga/actions';
import { createCapabilityRunner } from '../aga/capabilityRunner';
import { localControlIntent } from '../aga/localControls';
import { detectWake } from '../aga/text';
import { shouldAcceptFinalSpeech } from '../aga/turnGate';
import { FinalSpeechDeduper, SerialTurnQueue } from '../aga/turnQueue';
import { askBrain, translatePhrase } from '../backend/brain';
import {
  addMessage,
  initializeLocalStore,
  listMessages,
  listPendingReminders,
  loadPreferences,
  logEvent,
  savePreferences,
  searchMemories,
  startNewConversationSession,
  type Preferences,
} from '../db/localStore';
import { measureAsync, measureMark } from '../observability/measure';
import { configureNotificationHandler } from '../notifications/localNotifications';
import { NativeSpeechLoop } from './nativeSpeech';
import { getTtsDiagnostics, isTtsAvailable, primeTts, speak, stopSpeaking } from './tts';
import { getVoiceCapability, summarizeVoiceCapability } from './voiceHealth';
import type { AgaAction, AgaMode } from '../aga/turn';
import type { ChoiceMenu } from '../aga/choiceMenus';
import { EMPTY_VOICE_TRANSPORT_SNAPSHOT, type VoiceTransport, type VoiceTransportListener, type VoiceTransportSnapshot } from './VoiceTransport';

const ACTIVE_WINDOW_MS = 35_000;
const MANUAL_AWAKE_MS = 45_000;
const DEFAULT_VOICE = process.env.EXPO_PUBLIC_AGA_REALTIME_VOICE || process.env.EXPO_PUBLIC_OPENAI_REALTIME_VOICE || 'marin';

function initialPrefs(): Preferences {
  return {
    wakePhrase: process.env.EXPO_PUBLIC_AGA_WAKE_WORD || 'aga',
    persona: 'warm',
    voiceLocale: 'en-US',
    openaiApiKey: process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? '',
    geminiApiKey: process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '',
    brainMode: 'realtime',
    translateTarget: null,
    showDiagnostics: false,
    proactiveReminders: true,
  };
}

function actionToTool(action: AgaAction): { name: string; args: Record<string, unknown> } | null {
  switch (action.type) {
    case 'remember': return { name: 'remember', args: { text: action.text } };
    case 'recall': return { name: 'recall', args: { query: action.query } };
    case 'add_reminder': return { name: 'set_reminder', args: { text: action.text, when_iso: action.dueAt } };
    case 'list_reminders': return { name: 'list_reminders', args: {} };
    case 'clear_reminders': return { name: 'clear_reminders', args: {} };
    case 'play_youtube':
    case 'youtube_play': return { name: 'play_youtube', args: { query: action.query } };
    case 'media_pause': return { name: 'media_control', args: { command: 'pause' } };
    case 'media_resume': return { name: 'media_control', args: { command: 'resume' } };
    case 'media_stop': return { name: 'media_control', args: { command: 'stop' } };
    case 'set_persona': return { name: 'set_persona', args: { persona: action.persona } };
    case 'translate_start': return { name: 'set_translate', args: { target: action.target } };
    case 'translate_stop': return { name: 'set_translate', args: { target: null } };
    case 'open_settings': return { name: 'show_settings_menu', args: { category: 'main' } };
    case 'reset_conversation': return { name: 'start_new_conversation_session', args: { reason: 'local_reset_conversation', endActiveSkill: true } };
    default: return null;
  }
}

export class LocalTransport implements VoiceTransport {
  readonly name = 'local-transport';
  private listeners = new Set<VoiceTransportListener>();
  private loop: NativeSpeechLoop | null = null;
  private stopped = false;
  private started = false;
  private finalDeduper = new FinalSpeechDeduper();
  private turnQueue = new SerialTurnQueue();
  private prefs: Preferences = initialPrefs();
  private activeUntil = 0;
  private mode: AgaMode = 'sleeping';
  private snapshot: VoiceTransportSnapshot = { ...EMPTY_VOICE_TRANSPORT_SNAPSHOT };
  private activeChoiceMenu: ChoiceMenu | null = null;

  private runner = createCapabilityRunner({
    getPrefs: () => this.prefs,
    setPrefs: (prefs) => { this.prefs = prefs; },
    publish: (patch) => this.publish(patch as Partial<VoiceTransportSnapshot>),
    setMode: (mode) => this.setMode(mode),
    refresh: () => this.refresh(),
    updateRealtimeSession: () => undefined,
    applyRemoteConfig: async () => undefined,
    requestReconnect: () => undefined,
    getActiveChoiceMenu: () => this.activeChoiceMenu,
    defaultVoice: DEFAULT_VOICE,
  });

  subscribe(listener: VoiceTransportListener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  private publish(patch: Partial<VoiceTransportSnapshot>) {
    const tts = getTtsDiagnostics();
    const capability = getVoiceCapability();
    const next = { ...this.snapshot, ...patch };
    if ('activeChoiceMenu' in patch) this.activeChoiceMenu = patch.activeChoiceMenu ?? null;
    this.snapshot = {
      ...next,
      ttsStatus: `${tts.provider}${tts.available ? '' : ':unavailable'}${tts.unlocked ? ':unlocked' : ''}${tts.lastError ? ` — ${tts.lastError}` : ''}`,
      voiceCapability: capability,
      voiceSummary: summarizeVoiceCapability(capability),
    };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  private setMode(mode: AgaMode) {
    this.mode = mode;
    this.publish({ mode });
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    await measureAsync('localTransport.start', async () => {
      configureNotificationHandler();
      await initializeLocalStore();
      this.prefs = await loadPreferences();
      await this.refresh();
      const ttsReady = await isTtsAvailable().catch(() => false);
      this.publish({
        ready: true,
        mode: 'sleeping',
        speechStatus: ttsReady ? `local transport ready — say ${this.prefs.wakePhrase || 'AGA'}` : 'local transport ready, voice output unavailable',
        error: null,
      });
      await this.startSpeechLoop();
    });
  }

  async stop() {
    this.stopped = true;
    this.started = false;
    this.turnQueue.stop();
    await stopSpeaking().catch(() => undefined);
    await this.loop?.destroy?.();
    this.loop = null;
  }

  async rearmMic() {
    this.finalDeduper.reset();
    this.activeUntil = Date.now() + MANUAL_AWAKE_MS;
    await primeTts(this.prefs.voiceLocale || 'en-US').catch(() => false);
    await this.loop?.stop?.('manual_rearm').catch(() => undefined);
    await this.startSpeechLoop();
    this.publish({ speechStatus: 'manual rearm complete; AGA is awake for 45 seconds' });
  }

  async replay(text: string) {
    await this.say(text);
  }

  async closeMedia() {
    this.publish({ activeMedia: null, mediaCommand: 'stop' });
    this.setMode('listening');
  }

  onMediaEvent(raw: string) {
    const current = this.snapshot.activeMedia;
    if (!current) return;
    const state = raw.includes('paused') ? 'paused' : raw.includes('playing') ? 'playing' : raw.includes('ended') ? 'stopped' : current.state;
    this.publish({ activeMedia: { ...current, state }, mediaCommand: null });
    void logEvent('media.event', String(raw).slice(0, 120));
  }

  private async startSpeechLoop() {
    await this.loop?.destroy?.();
    this.loop = new NativeSpeechLoop({
      onPartial: (text) => this.publish({ interim: text, error: null }),
      onFinal: (text) => this.turnQueue.enqueue(() => this.onTurnText(text)),
      onError: (message) => this.publish({ speechStatus: `mic: ${message}`, error: /unavailable|unsupported|not available/i.test(message) ? null : message }),
      onStatus: (status) => this.publish({ speechStatus: status }),
    });
    await this.loop.start({ watchdogEnabled: true });
    this.setMode('listening');
  }

  private async refresh() {
    const [messages, reminders] = await Promise.all([listMessages(16), listPendingReminders(6)]);
    this.publish({ messages, reminders });
  }

  private async say(text: string) {
    const clean = String(text || '').trim();
    if (!clean) return;
    this.setMode('speaking');
    await addMessage('assistant', clean).catch(() => undefined);
    await this.refresh();
    await speak(clean, { locale: this.prefs.voiceLocale || 'en-US' }).catch(async (error) => {
      await logEvent('tts.error', error instanceof Error ? error.message : String(error || 'tts failed')).catch(() => undefined);
    });
    if (!this.snapshot.activeMedia) this.setMode('listening');
  }

  private async runTool(name: string, args: Record<string, unknown> = {}, speakResult = true) {
    const result = await this.runner.run(name, args);
    await this.refresh();
    if (speakResult && result) await this.say(result);
    return result;
  }

  private async handleParsedAction(action: AgaAction) {
    if (action.type === 'speak') return this.say(action.text);
    if (action.type === 'stop_speaking') {
      await stopSpeaking().catch(() => undefined);
      this.setMode('listening');
      return;
    }
    if (action.type === 'test_voice') return this.say('My voice is working. I am listening locally.');
    if (action.type === 'status') {
      const memories = await searchMemories(undefined, 4);
      return this.say(`Local transport is running. I have ${memories.length} recent memories and ${this.snapshot.reminders.length} pending reminders visible.`);
    }
    if (action.type === 'show_diagnostics') {
      this.prefs = await savePreferences({ showDiagnostics: !this.prefs.showDiagnostics });
      return this.say(this.prefs.showDiagnostics ? 'Diagnostics are on.' : 'Diagnostics are off.');
    }
    if (action.type === 'set_wake_phrase') {
      this.prefs = await savePreferences({ wakePhrase: action.phrase.toLowerCase() });
      return this.say(`Wake phrase set to ${action.phrase}.`);
    }
    if (action.type === 'request_notifications') return this.say('Notifications are handled by the reminder capability.');
    const tool = actionToTool(action);
    if (tool) return this.runTool(tool.name, tool.args);
  }

  async onTurnText(recognized: string) {
    const text = String(recognized || '').trim();
    if (!text || this.stopped || this.finalDeduper.shouldDrop(text)) return;

    const gate = shouldAcceptFinalSpeech(this.mode, text, false);
    if (gate.isBargeIn) {
      await stopSpeaking().catch(() => undefined);
      this.setMode(this.snapshot.activeMedia ? 'media' : 'listening');
      return;
    }

    const wake = detectWake(text, this.prefs.wakePhrase);
    const woke = wake.woke || hasWakeWord(text, this.prefs.wakePhrase);
    const active = Date.now() < this.activeUntil;
    const local = localControlIntent(text);

    if (!woke && !active && !local && !this.prefs.translateTarget) {
      this.publish({ interim: text, speechStatus: `heard background — say ${this.prefs.wakePhrase || 'AGA'}` });
      return;
    }

    this.activeUntil = Date.now() + ACTIVE_WINDOW_MS;
    this.setMode(this.prefs.translateTarget && !woke ? 'translating' : 'thinking');
    this.publish({ interim: text, error: null });
    await addMessage('user', text);
    await logEvent('voice.final', text.slice(0, 240));
    await this.refresh();

    try {
      if (local) {
        await this.runTool(local.tool, local.args ?? {}, local.userVisible !== false);
        return;
      }

      if (this.prefs.translateTarget && !woke) {
        const translated = await translatePhrase(text, this.prefs.translateTarget, this.prefs);
        await this.say(translated);
        return;
      }

      const parsed = parseVoiceCommand(text, this.prefs.wakePhrase);
      measureMark('localTransport.action.plan', { intent: parsed.intent, actions: parsed.actions.map((a) => a.type).join(',') });
      for (const action of parsed.actions) {
        if (action.type !== 'chat') await this.handleParsedAction(action);
      }
      const chat = parsed.actions.find((action) => action.type === 'chat');
      if (chat?.type === 'chat') {
        const [history, memories] = await Promise.all([listMessages(20), searchMemories(undefined, 8)]);
        const reply = await askBrain({ text: chat.text, prefs: this.prefs, history, memories });
        await this.say(reply);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'local turn failed');
      this.publish({ error: message });
      await logEvent('localTransport.turn.error', message);
      await this.say('I hit a small glitch, but I am still here.');
    } finally {
      await this.refresh();
      if (!this.snapshot.activeMedia && this.mode !== 'translating') this.setMode('listening');
    }
  }
}
