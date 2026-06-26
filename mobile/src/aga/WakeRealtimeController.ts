import { createWakeEngine, type WakeEngine, type WakeEngineEvent } from '../voice/wakeEngine';
import { createPostWakeCommandEngine, postWakeWindowMs } from '../voice/postWakeCommandEngine';
import { speakShortReply, stopSpeaking } from '../voice/speechOut';
import { classifyTurnForVoicePath } from '../voice/liveEscalation';
import { DeterministicGuidedRunner } from '../sessions/deterministicGuidedRunner';
import { guidedKindFromText } from '../sessions/guidedPhaseScripts';
import { subconsciousRecall } from '../memory/subconsciousRag';
import { initializeLocalStore, listMessages, listPendingReminders, loadPreferences, logEvent, startNewConversationSession, type Preferences } from '../db/localStore';
import { normalizeSpeech } from './text';
import { agaEngineDiagnostics, getAgaEngine } from './engine';
import { measureAsync, measureMark } from '../observability/measure';
import type { RealtimeSnapshot } from '../realtime/RealtimeSession';
import type { AgaMode } from './turn';

type Listener = (snapshot: RealtimeSnapshot) => void;

type VoiceSessionLike = {
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
  subscribe(listener: (snapshot: RealtimeSnapshot) => void): () => void;
  replay(text: string): void;
  closeMedia?(): void;
  onMediaEvent?(event: string): void;
  rearmMic?(): void;
};

function env(name: string) {
  return process.env?.[name] ?? '';
}

function envFlag(name: string, fallback: boolean) {
  const raw = env(name).trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function numberEnv(name: string, fallback: number) {
  const n = Number(env(name));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function selectedEngine() {
  return getAgaEngine();
}

function postWakeReply() {
  return env('EXPO_PUBLIC_AGA_POST_WAKE_REPLY') || 'Yes?';
}

/**
 * Appliance runtime controller.
 *
 * Always-on mic: Porcupine keyword indexes only (aga/stop/pause by default).
 * Post-wake: short TTS for simple confirmations; deterministic runner for guided
 * sessions; OpenAI/Gemini live session only when interaction truly needs it.
 */
export class WakeRealtimeController {
  private listeners = new Set<Listener>();
  private wakeEngine: WakeEngine | null = null;
  private realtime: VoiceSessionLike | null = null;
  private realtimeUnsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private prefs: Preferences | null = null;
  private started = false;
  private guided = new DeterministicGuidedRunner();
  private guidedUnsub: (() => void) | null = null;
  private postWakeCommand: { start(): Promise<void> | void; stop(): Promise<void> | void; getDiagnostics?(): unknown } | null = null;
  private postWakeTimer: ReturnType<typeof setTimeout> | null = null;

  private snapshot: RealtimeSnapshot = {
    ready: false,
    mode: 'sleeping',
    interim: '',
    messages: [],
    reminders: [],
    activeMedia: null,
    mediaCommand: null,
    audioLevel: 0,
    speechStatus: 'starting wake scout',
    heardText: '',
    wakeProvider: '',
    error: null,
    activeChoiceMenu: null,
    sessionLabel: null,
  } as RealtimeSnapshot;

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  private publish(patch: Partial<RealtimeSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch } as RealtimeSnapshot;
    for (const listener of this.listeners) listener(this.snapshot);
  }

  private setMode(mode: AgaMode) {
    this.publish({ mode });
  }

  async start() {
    return measureAsync('wakeRealtime.porcupine.start', async () => {
      if (this.started) return;
      this.started = true;
      await initializeLocalStore();
      this.prefs = await loadPreferences();
      if (envFlag('EXPO_PUBLIC_AGA_CLEAR_TRANSIENT_ON_BOOT', true)) {
        await startNewConversationSession('app_boot', { clearTranscript: true, endActiveSession: false }).catch(() => undefined);
      }
      await this.refresh();
      const diagnostics = agaEngineDiagnostics();
      this.publish({ ready: true, mode: 'listening', speechStatus: 'wake engine starting', voiceSummary: JSON.stringify(diagnostics), voiceCapability: diagnostics } as any);
      this.guidedUnsub = this.guided.subscribe((state) => {
        if (!state.active) {
          this.publish({ sessionLabel: null });
          return;
        }
        this.publish({ mode: state.waitingForUser ? 'listening' : 'speaking', sessionLabel: state.phaseLabel || state.kind, speechStatus: state.waitingForUser ? 'guided session waiting for voice response' : `guided: ${state.phaseLabel || state.kind}` });
      });
      await this.startWakeScout('boot');
    });
  }

  async stop() {
    this.started = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.guidedUnsub?.();
    this.guidedUnsub = null;
    await this.guided.stop('controller_stop').catch(() => undefined);
    await this.stopPostWakeCommandWindow('controller_stop');
    await this.stopWakeScout('controller_stop');
    await this.stopRealtime('controller_stop');
    this.publish({ mode: 'sleeping', speechStatus: 'stopped' });
  }

  replay(text: string) {
    const clean = normalizeSpeech(text);
    if (!clean) return;
    void this.handleTurnText(clean, 'replay');
  }

  closeMedia() {
    this.realtime?.closeMedia?.();
    this.publish({ activeMedia: null, mediaCommand: 'stop' });
  }

  onMediaEvent(event: string) {
    this.realtime?.onMediaEvent?.(event);
  }

  rearmMic() {
    void this.startWakeScout('manual_rearm');
  }

  private async refresh() {
    const [messages, reminders] = await Promise.all([
      listMessages(12).catch(() => []),
      listPendingReminders(8).catch(() => []),
    ]);
    this.publish({ messages, reminders } as any);
  }

  private async startWakeScout(reason: string) {
    if (!this.started || this.wakeEngine) return;
    this.wakeEngine = createWakeEngine({ onEvent: (event) => this.onWakeEvent(event) });
    try {
      await this.wakeEngine.start();
      const wakeDiagnostics = this.wakeEngine.getDiagnostics?.() as any;
      const provider = String(wakeDiagnostics?.provider || (wakeDiagnostics?.diagnostics?.provider) || 'wake');
      this.publish({ mode: 'listening', speechStatus: `${provider} listening (${reason})`, error: null, wakeProvider: provider, voiceCapability: { ...(this.snapshot as any).voiceCapability, wakeProvider: provider, wakeDiagnostics } } as any);
      await logEvent('wake.keyword.start', reason).catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'wake engine failed');
      this.publish({ mode: 'recovering', speechStatus: 'wake engine failed', error: message, heardText: '' } as any);
      await logEvent('wake.porcupine.error', message).catch(() => undefined);
    }
  }

  private async stopWakeScout(reason: string) {
    const engine = this.wakeEngine;
    this.wakeEngine = null;
    if (engine) await engine.stop().catch(() => undefined);
    await logEvent('wake.keyword.stop', reason).catch(() => undefined);
  }

  private onWakeEvent(event: WakeEngineEvent) {
    if (event.type === 'status') {
      this.publish({ speechStatus: event.status } as any);
      return;
    }
    if (event.type === 'error') {
      this.publish({ error: event.message, speechStatus: 'wake error' } as any);
      return;
    }
    if (event.type === 'control') {
      this.publish({ heardText: event.command, wakeProvider: event.source } as any);
      void this.handleKeywordControl(event.command);
      return;
    }
    if (event.type === 'wake') {
      this.publish({ heardText: `keyword detected: ${event.label || 'aga'}`, interim: '', wakeProvider: event.source } as any);
      void this.handleWake('', event.source);
    }
  }

  private async handleKeywordControl(command: 'stop' | 'pause' | 'resume') {
    measureMark('wake.keyword.control', { command });
    if (command === 'stop') {
      await stopSpeaking().catch(() => undefined);
      await this.guided.stop('keyword_stop').catch(() => undefined);
      await this.stopRealtime('keyword_stop').catch(() => undefined);
      this.publish({ activeMedia: null, mediaCommand: 'stop', mode: 'listening', speechStatus: 'stopped by keyword', heardText: 'keyword detected: stop' } as any);
      await this.startWakeScout('keyword_stop').catch(() => undefined);
      return;
    }
    if (command === 'pause') {
      await stopSpeaking().catch(() => undefined);
      await this.guided.control('pause').catch(() => undefined);
      this.realtime?.replay('pause');
      this.publish({ mediaCommand: 'pause', speechStatus: 'paused by keyword', heardText: 'keyword detected: pause' } as any);
      return;
    }
    if (command === 'resume') {
      await this.guided.control('resume').catch(() => undefined);
      this.realtime?.replay('resume');
      this.publish({ mediaCommand: 'resume', speechStatus: 'resumed by keyword', heardText: 'keyword detected: resume' } as any);
    }
  }

  private async handleWake(text: string, source: string) {
    await logEvent('wake.accepted', `${source}:${text || 'keyword_only'}`).catch(() => undefined);
    this.publish({ interim: '', heardText: 'keyword detected: aga', speechStatus: 'wake detected — opening command ear', mode: 'awake' } as any);
    if (envFlag('EXPO_PUBLIC_AGA_POST_WAKE_TTS_ACK', true)) {
      void speakShortReply(postWakeReply(), 'warm').catch(() => undefined);
    }
    const commandWindowOpened = await this.openPostWakeCommandWindow(source);
    if (!commandWindowOpened) {
      await this.activateLiveSession('The user said AGA. Listen for their next request and reply briefly.');
    }
  }

  private async handleTurnText(text: string, source: 'wake' | 'replay' | 'command_window') {
    await this.stopPostWakeCommandWindow('turn_text').catch(() => undefined);
    this.publish({ heardText: text, interim: text, speechStatus: source === 'replay' ? `replay: ${text.slice(0, 54)}` : `heard: ${text.slice(0, 54)}` } as any);
    const activeOptions = ((this.snapshot as any).activeChoiceMenu?.options || []) as any[];
    if (activeOptions.length) {
      const { resolveChoicePhrase } = await import('../voice/multilingualChoiceAliases');
      const choice = resolveChoicePhrase(text, activeOptions);
      if (choice) {
        this.publish({ speechStatus: `selected ${choice.label}`, heardText: `selected: ${choice.label}`, selectedChoiceKey: choice.key } as any);
        if (this.realtime) this.realtime.replay(`choose option ${choice.key}`);
        else await this.activateLiveSession(`choose option ${choice.key}`);
        return;
      }
    }
    if (this.guided && await this.guided.acceptUserResponse(text).catch(() => false)) return;
    const kind = guidedKindFromText(text);
    const route = classifyTurnForVoicePath(text);
    if (route === 'deterministic_session' && kind) {
      await this.stopRealtime('deterministic_guided');
      await this.stopWakeScout('deterministic_guided');
      await this.guided.start(kind, text);
      await this.startWakeScout('guided_controls').catch(() => undefined);
      return;
    }
    if (route === 'short_tts') {
      await this.handleShortTextCommand(text);
      return;
    }
    await this.activateLiveSession(text);
  }

  private async handleShortTextCommand(text: string) {
    const lower = text.toLowerCase();
    const context = await subconsciousRecall(text).catch(() => null);
    await logEvent('turn.short_tts', `${text.slice(0, 180)} memories=${context?.memories.length || 0}`).catch(() => undefined);
    if (/\b(status|diagnostic|are you there)\b/i.test(lower)) {
      await speakShortReply('I am here. Wake words are local. Short replies use expressive TTS. Live sessions open only when needed.', 'warm');
    } else if (/\b(thank you|thanks)\b/i.test(lower)) {
      await speakShortReply('Always.', 'warm');
    } else if (/\b(stop|quiet|cancel)\b/i.test(lower)) {
      await this.handleKeywordControl('stop');
    } else if (/\b(pause|hold)\b/i.test(lower)) {
      await this.handleKeywordControl('pause');
    } else {
      await this.activateLiveSession(text);
      return;
    }
    await this.refresh();
    await this.startWakeScout('short_tts_done').catch(() => undefined);
  }

  private async activateLiveSession(initialText: string) {
    if (this.realtime) {
      this.realtime.replay(initialText);
      this.armIdleTimer();
      return;
    }
    await this.stopPostWakeCommandWindow('live_session');
    await this.stopWakeScout('live_session');
    if (envFlag('EXPO_PUBLIC_AGA_FRESH_CONTEXT_PER_WAKE', true)) {
      await startNewConversationSession('wake_activation', { clearTranscript: true, endActiveSession: false }).catch(() => undefined);
    }
    this.publish({ mode: 'thinking', speechStatus: `${selectedEngine()} live session starting`, error: null, heardText: initialText } as any);
    const session = await this.createSelectedVoiceSession();
    this.realtime = session;
    this.realtimeUnsubscribe = session.subscribe((next) => {
      this.publish({ ...next, speechStatus: next.speechStatus || 'live session active' });
      this.armIdleTimer();
    });
    try {
      await session.start();
      session.replay(initialText);
      this.armIdleTimer();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'live session failed');
      this.publish({ mode: 'recovering', speechStatus: 'live session failed; returning to Porcupine', error: message });
      await logEvent('realtime.start.error', message).catch(() => undefined);
      await this.stopRealtime('start_error').catch(() => undefined);
      await this.startWakeScout('live_start_failed').catch(() => undefined);
    }
  }

  private getActiveChoices() {
    return (((this.snapshot as any).activeChoiceMenu?.options || []) as any[]).map((option, index) => ({
      key: option.key ?? index + 1,
      label: option.label || option.title || `Option ${index + 1}`,
      title: option.title,
      description: option.description,
      aliases: option.aliases,
    }));
  }

  private async openPostWakeCommandWindow(source: string) {
    await this.stopWakeScout('post_wake_command');
    await this.stopPostWakeCommandWindow('replace').catch(() => undefined);
    const engine = createPostWakeCommandEngine({
      getChoices: () => this.getActiveChoices(),
      onStatus: (status) => this.publish({ speechStatus: status, mode: 'listening' } as any),
      onError: (message) => this.publish({ error: message, speechStatus: 'post-wake command error' } as any),
      onResult: (result) => {
        if (result.type === 'control') {
          void this.handleKeywordControl(result.command);
          return;
        }
        if (result.type === 'choice' && result.choice) {
          void this.handleTurnText(`choose option ${result.choice.key}`, 'command_window');
          return;
        }
        if (result.type === 'text') {
          void this.handleTurnText(result.text, 'command_window');
        }
      },
    });
    if (!engine) return false;
    this.postWakeCommand = engine;
    try {
      await engine.start();
      const diagnostics = engine.getDiagnostics?.();
      this.publish({ mode: 'listening', speechStatus: 'post-wake command window open', voiceCapability: { ...(this.snapshot as any).voiceCapability, postWakeCommand: diagnostics } } as any);
      this.postWakeTimer = setTimeout(() => {
        void this.stopPostWakeCommandWindow('timeout').then(() => this.startWakeScout('post_wake_timeout'));
      }, postWakeWindowMs());
      await logEvent('post_wake_command.start', source).catch(() => undefined);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'post-wake command failed');
      this.postWakeCommand = null;
      this.publish({ error: message, speechStatus: 'post-wake command unavailable' } as any);
      await logEvent('post_wake_command.error', message).catch(() => undefined);
      return false;
    }
  }

  private async stopPostWakeCommandWindow(reason: string) {
    if (this.postWakeTimer) clearTimeout(this.postWakeTimer);
    this.postWakeTimer = null;
    const engine = this.postWakeCommand;
    this.postWakeCommand = null;
    if (engine) await engine.stop().catch(() => undefined);
    if (engine) await logEvent('post_wake_command.stop', reason).catch(() => undefined);
  }

  private async createSelectedVoiceSession(): Promise<VoiceSessionLike> {
    const engine = selectedEngine();
    if (engine === 'gemini') {
      const mod = await import('../gemini/GeminiLiveSession');
      return new mod.GeminiLiveSession({ onTurnDone: () => this.armIdleTimer() } as any);
    }
    if (engine === 'openai') {
      const mod = await import('../realtime/RealtimeSession');
      return new mod.RealtimeSession({ onTurnDone: () => this.armIdleTimer() } as any);
    }
    const mod = await import('./LocalTransport');
    return new mod.LocalTransport({ onTurnDone: () => this.armIdleTimer() } as any);
  }

  private async stopRealtime(reason: string) {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const session = this.realtime;
    this.realtime = null;
    this.realtimeUnsubscribe?.();
    this.realtimeUnsubscribe = null;
    if (session) await session.stop().catch(() => undefined);
    await logEvent('realtime.sleep', reason).catch(() => undefined);
    await this.refresh();
    if (this.started) await this.startWakeScout(reason).catch(() => undefined);
  }

  private armIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const delay = this.snapshot.activeMedia ? numberEnv('EXPO_PUBLIC_AGA_REALTIME_MEDIA_IDLE_MS', 5 * 60_000) : numberEnv('EXPO_PUBLIC_AGA_REALTIME_IDLE_MS', 45_000);
    this.idleTimer = setTimeout(() => void this.stopRealtime('idle_timeout'), delay);
  }
}
