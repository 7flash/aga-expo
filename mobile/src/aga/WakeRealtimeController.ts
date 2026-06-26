import { createWakeEngine, type WakeEngine, type WakeEngineEvent } from '../voice/wakeEngine';
import { createCapabilityRunner } from './capabilityRunner';
import { parseVoiceMenuCommand } from './voiceFirstMenuCommands';
import { selectedChoiceSpeech, spokenChoicePrompt } from '../voice/spokenMenuPrompts';
import { createPostWakeCommandEngine, postWakeWindowMs } from '../voice/postWakeCommandEngine';
import { speakShortReply, stopSpeaking } from '../voice/speechOut';
import { classifyTurnForVoicePath } from '../voice/liveEscalation';
import { answerShortTextWithGpt5, ShortReasoningAudioTurn } from './shortReasoningTurn';
import { DeterministicGuidedRunner } from '../sessions/deterministicGuidedRunner';
import { guidedKindFromText } from '../sessions/guidedPhaseScripts';
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
 * Always-on mic: Sherpa native/WASM keyword spotting by default, with Porcupine only as an optional fallback for aga/stop/pause.
 * Post-wake: local Sherpa command recognition first; then short OpenAI STT → GPT-5 tools → ElevenLabs TTS.
 * OpenAI/Gemini live session opens only for explicit live/practice/conversation modes.
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
  private capabilities: ReturnType<typeof createCapabilityRunner> | null = null;
  private shortAudioTurn: ShortReasoningAudioTurn | null = null;
  private shortAudioReason: string | null = null;
  private resolvingPostWake = false;

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
    return measureAsync('wakeRealtime.keyword.start', async () => {
      if (this.started) return;
      this.started = true;
      await initializeLocalStore();
      this.prefs = await loadPreferences();
      this.ensureCapabilities();
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
    await this.cancelShortAudioTurn('controller_stop').catch(() => undefined);
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


  private ensureCapabilities() {
    if (this.capabilities) return this.capabilities;
    this.capabilities = createCapabilityRunner({
      getPrefs: () => this.prefs,
      setPrefs: (prefs) => { this.prefs = prefs; },
      publish: (patch) => this.publish(patch as any),
      setMode: (mode) => this.setMode(mode),
      refresh: () => this.refresh(),
      updateRealtimeSession: () => undefined,
      applyRemoteConfig: async (reason: string) => { await logEvent('remote_config.apply_skipped', reason).catch(() => undefined); },
      requestReconnect: (reason: string) => { void logEvent('voice_runtime.reconnect_requested', reason).catch(() => undefined); },
      getActiveChoiceMenu: () => (this.snapshot as any).activeChoiceMenu ?? null,
      defaultVoice: env('EXPO_PUBLIC_AGA_REALTIME_VOICE') || env('EXPO_PUBLIC_OPENAI_REALTIME_VOICE') || 'guardian',
    });
    return this.capabilities;
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
      await logEvent('wake.keyword.error', message).catch(() => undefined);
    }
  }

  private async stopWakeScout(reason: string) {
    const engine = this.wakeEngine;
    this.wakeEngine = null;
    if (engine) await Promise.resolve(engine.stop()).catch(() => undefined);
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
    this.resolvingPostWake = false;
    this.publish({ interim: '', heardText: 'keyword detected: aga', speechStatus: 'wake detected — opening command ear', mode: 'awake' } as any);
    if (envFlag('EXPO_PUBLIC_AGA_POST_WAKE_TTS_ACK', true)) {
      void speakShortReply(postWakeReply(), 'warm').catch(() => undefined);
    }

    // Start buffering immediately after wake. Sherpa KWS may not emit unknown text,
    // so waiting until "no match" would lose the user's actual utterance.
    await this.startBufferedShortAudio(`post_wake:${source}`).catch((error) => {
      const message = error instanceof Error ? error.message : String(error || 'short buffer unavailable');
      this.publish({ error: message, speechStatus: 'short request buffer unavailable' } as any);
    });

    const commandWindowOpened = await this.openPostWakeCommandWindow(source);
    if (!commandWindowOpened) {
      await this.finishBufferedShortAudio('no_post_wake_command_engine');
    }
  }

  private async handleTurnText(text: string, source: 'wake' | 'replay' | 'command_window') {
    await this.stopPostWakeCommandWindow('turn_text').catch(() => undefined);
    await this.cancelShortAudioTurn('text_arrived').catch(() => undefined);
    this.publish({ heardText: text, interim: text, speechStatus: source === 'replay' ? `replay: ${text.slice(0, 54)}` : `heard: ${text.slice(0, 54)}` } as any);

    const activeMenu = (this.snapshot as any).activeChoiceMenu ?? null;
    if (activeMenu?.options?.length) {
      const applied = await this.applyChoiceText(text);
      if (applied) return;
    }

    const menuCommand = parseVoiceMenuCommand(text, activeMenu);
    if (menuCommand && await this.handleVoiceMenuCommand(menuCommand)) return;

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
    if (route === 'live_audio') {
      await this.activateLiveSession(text);
      return;
    }
    await this.handleReasonedShortTextCommand(text);
  }

  private async applyChoiceText(text: string) {
    await this.cancelShortAudioTurn('choice_selected').catch(() => undefined);
    const runner = this.ensureCapabilities();
    const result = await runner.chooseFromText(text).catch((error: unknown) => error instanceof Error ? error.message : String(error || 'choice failed'));
    if (!result) return false;
    const activeMenu = (this.snapshot as any).activeChoiceMenu ?? null;
    const spoken = String(result || selectedChoiceSpeech(text));
    this.publish({ speechStatus: spoken.slice(0, 96), heardText: `selected: ${text}`, interim: '', mode: 'speaking' } as any);
    await speakShortReply(spoken, activeMenu?.id === 'voice' ? 'bright' : 'warm').catch(() => undefined);
    await this.refresh();
    const nextMenu = (this.snapshot as any).activeChoiceMenu ?? null;
    if (nextMenu?.options?.length) {
      await speakShortReply(spokenChoicePrompt(nextMenu), 'warm').catch(() => undefined);
      await this.openPostWakeCommandWindow('choice_followup').catch(() => undefined);
    } else {
      await this.startWakeScout('choice_done').catch(() => undefined);
    }
    return true;
  }

  private async handleVoiceMenuCommand(command: NonNullable<ReturnType<typeof parseVoiceMenuCommand>>) {
    const activeMenu = (this.snapshot as any).activeChoiceMenu ?? null;
    if (command.type === 'repeat_menu') {
      await speakShortReply(spokenChoicePrompt(activeMenu), 'warm').catch(() => undefined);
      await this.openPostWakeCommandWindow('repeat_menu').catch(() => undefined);
      return true;
    }
    if (command.type === 'close_menu') {
      this.publish({ activeChoiceMenu: null, heardText: 'menu closed', speechStatus: 'menu closed', mode: 'listening' } as any);
      await speakShortReply('Menu closed.', 'warm').catch(() => undefined);
      await this.startWakeScout('menu_closed').catch(() => undefined);
      return true;
    }
    const runner = this.ensureCapabilities();
    const response = await runner.run('show_settings_menu', { category: command.category });
    this.publish({ speechStatus: response.slice(0, 96), heardText: `${command.category} menu`, mode: 'speaking' } as any);
    await speakShortReply(spokenChoicePrompt((this.snapshot as any).activeChoiceMenu), 'warm').catch(() => undefined);
    await this.openPostWakeCommandWindow(`menu:${command.category}`).catch(() => undefined);
    return true;
  }

  private async handleReasonedShortTextCommand(text: string) {
    const lower = text.toLowerCase();
    await logEvent('turn.short_reasoning', text.slice(0, 180)).catch(() => undefined);
    if (/\b(stop|quiet|cancel)\b/i.test(lower)) {
      await this.handleKeywordControl('stop');
      return;
    }
    if (/\b(pause|hold)\b/i.test(lower)) {
      await this.handleKeywordControl('pause');
      return;
    }
    try {
      const runner = this.ensureCapabilities();
      await answerShortTextWithGpt5(text, {
        getPrefs: () => this.prefs,
        runCapability: (name, args) => runner.run(name, args),
        publish: (patch) => this.publish(patch as any),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'short reasoning failed');
      this.publish({ error: message, speechStatus: 'short reasoning failed' } as any);
      await speakShortReply('I had trouble thinking through that. Please say AGA and try again.', 'warm').catch(() => undefined);
    }
    await this.refresh();
    await this.startWakeScout('short_reasoning_done').catch(() => undefined);
  }

  private async startBufferedShortAudio(reason: string) {
    await this.cancelShortAudioTurn(`replace_buffer:${reason}`).catch(() => undefined);
    const runner = this.ensureCapabilities();
    const turn = new ShortReasoningAudioTurn({
      getPrefs: () => this.prefs,
      runCapability: (name, args) => runner.run(name, args),
      publish: (patch) => this.publish(patch as any),
    });
    this.shortAudioTurn = turn;
    this.shortAudioReason = reason;
    await turn.start();
    await logEvent('short_utterance.buffer_start', reason).catch(() => undefined);
  }

  private async finishBufferedShortAudio(reason: string) {
    if (this.resolvingPostWake) return;
    this.resolvingPostWake = true;
    await this.stopPostWakeCommandWindow(`finish_short_audio:${reason}`).catch(() => undefined);
    const turn = this.shortAudioTurn;
    this.shortAudioTurn = null;
    const startedBecause = this.shortAudioReason;
    this.shortAudioReason = null;
    if (!turn) {
      await this.startWakeScout(`no_short_audio:${reason}`).catch(() => undefined);
      this.resolvingPostWake = false;
      return;
    }
    try {
      await logEvent('short_utterance.buffer_finish', `${reason}; started=${startedBecause || 'unknown'}`).catch(() => undefined);
      await turn.stopAndAnswer();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'short utterance failed');
      this.publish({ error: message, speechStatus: 'short utterance failed' } as any);
      await speakShortReply('I did not catch that clearly. Please say AGA and try again.', 'warm').catch(() => undefined);
    } finally {
      this.resolvingPostWake = false;
      void this.refresh();
      void this.startWakeScout(`short_utterance_done:${reason}`);
    }
  }

  private async captureShortUtteranceAndReason(reason: string) {
    // Compatibility path: this now finishes the buffered post-wake recording
    // instead of starting a new recording after the user's words are already gone.
    await this.finishBufferedShortAudio(reason);
  }

  private async cancelShortAudioTurn(reason: string) {
    const turn = this.shortAudioTurn;
    this.shortAudioTurn = null;
    this.shortAudioReason = null;
    if (turn) await turn.cancel().catch(() => undefined);
    if (turn) await logEvent('short_utterance.cancel', reason).catch(() => undefined);
  }

  private async activateLiveSession(initialText: string) {
    if (this.realtime) {
      this.realtime.replay(initialText);
      this.armIdleTimer();
      return;
    }
    await this.cancelShortAudioTurn('live_session').catch(() => undefined);
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
      this.publish({ mode: 'recovering', speechStatus: 'live session failed; returning to keyword wake', error: message });
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
          void this.cancelShortAudioTurn('post_wake_control').finally(() => this.handleKeywordControl(result.command));
          return;
        }
        if (result.type === 'choice' && result.choice) {
          void this.applyChoiceText(String(result.choice.key));
          return;
        }
        if (result.type === 'text') {
          void this.handleTurnText(result.text, 'command_window');
          return;
        }
        if (result.type === 'no_match') {
          void this.finishBufferedShortAudio(result.reason);
        }
      },
    });
    if (!engine) return false;
    this.postWakeCommand = engine;
    try {
      await engine.start();
      const diagnostics = engine.getDiagnostics?.();
      const prompt = spokenChoicePrompt((this.snapshot as any).activeChoiceMenu);
      this.publish({ mode: 'listening', speechStatus: (this.snapshot as any).activeChoiceMenu ? prompt : 'post-wake command window open', voiceCapability: { ...(this.snapshot as any).voiceCapability, postWakeCommand: diagnostics } } as any);
      this.postWakeTimer = setTimeout(() => {
        void this.finishBufferedShortAudio('post_wake_timeout');
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
    if (engine) await Promise.resolve(engine.stop()).catch(() => undefined);
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
    await this.cancelShortAudioTurn(`stop_realtime:${reason}`).catch(() => undefined);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const session = this.realtime;
    this.realtime = null;
    this.realtimeUnsubscribe?.();
    this.realtimeUnsubscribe = null;
    if (session) await Promise.resolve(session.stop()).catch(() => undefined);
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
