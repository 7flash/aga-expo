import { NativeSpeechLoop } from '../voice/nativeSpeech';
import { loadPreferences, initializeLocalStore, listMessages, listPendingReminders, logEvent, startNewConversationSession, type Preferences } from '../db/localStore';
import { detectWake, removeWakePhrase, normalizeSpeech } from './text';
import { measureAsync, measureMark } from '../observability/measure';
import type { RealtimeSnapshot } from '../realtime/RealtimeSession';
import { agaEngineDiagnostics, getAgaEngine } from './engine';

const DEFAULT_WAKE_IDLE_MS = 45_000;
const DEFAULT_MEDIA_IDLE_MS = 5 * 60_000;

function env(name: string) {
  return process.env?.[name] ?? '';
}

function numberEnv(name: string, fallback: number) {
  const raw = Number(env(name));
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function envFlag(name: string, fallback: boolean) {
  const raw = env(name).trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function selectedVoiceEngine() {
  return getAgaEngine();
}

function geminiTransportPreference() {
  return (
    env('EXPO_PUBLIC_AGA_GEMINI_TRANSPORT') ||
    env('EXPO_PUBLIC_GEMINI_TRANSPORT') ||
    ''
  ).trim().toLowerCase();
}

function canUseWakelessGeminiDuplex() {
  const engine = selectedVoiceEngine();
  if (engine !== 'gemini') return false;
  const transport = geminiTransportPreference();
  const duplexish = transport === 'duplex' || transport === 'auto' || envFlag('EXPO_PUBLIC_AGA_GEMINI_DUPLEX', false);
  return duplexish && envFlag('EXPO_PUBLIC_AGA_GEMINI_WAKELESS_DUPLEX', true);
}

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

/**
 * Product voice lifecycle:
 * 1. Always-on local wake scout listens only for “AGA” / configured wake phrase.
 * 2. After wake, start the selected post-wake engine: Gemini turn mode or OpenAI Realtime.
 * 3. Keep it open while the user is talking, choosing menus, or controlling media.
 * 4. When idle / turn complete, close the active engine and return to local wake scout.
 *
 * This preserves privacy/cost/battery and prevents the wake scout from billing cloud models until summoned.
 */
export class WakeRealtimeController {
  private listeners = new Set<Listener>();
  private wakeLoop: NativeSpeechLoop | null = null;
  private realtime: VoiceSessionLike | null = null;
  private realtimeUnsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private prefs: Preferences | null = null;
  private started = false;
  private wakeActivationInFlight = false;
  private lastWakeFingerprint = '';
  private wakeRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private wakeStatusLogAt = 0;
  private wakeEvents = { partials: 0, finals: 0, errors: 0, statuses: 0, starts: 0 };
  private lastWakeDiagnostics: any = null;

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
    error: null,
    activeChoiceMenu: null,
    sessionLabel: null,
  };

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  private publish(patch: Partial<RealtimeSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  async start() {
    return measureAsync('wakeRealtime.start', async () => {
      if (this.started) return;
      this.started = true;
      await initializeLocalStore();
      this.prefs = await loadPreferences();
      const engineInfo = agaEngineDiagnostics();
      this.publish({ speechStatus: `wake scout booting → ${engineInfo.engine}`, voiceSummary: JSON.stringify(engineInfo), voiceCapability: engineInfo });
      await logEvent('engine.selected', JSON.stringify(engineInfo)).catch(() => undefined);
      measureMark('engine.selected', engineInfo);
      if (envFlag('EXPO_PUBLIC_AGA_CLEAR_TRANSIENT_ON_BOOT', true)) {
        await startNewConversationSession('app_boot', { clearTranscript: true, endActiveSession: true }).catch(() => undefined);
        await logEvent('conversation.session.boot_reset', 'cleared transient transcript/session/language on app start').catch(() => undefined);
        this.prefs = await loadPreferences();
      }
      await this.refresh();
      await this.startWakeScout('initial');
    });
  }

  private async refresh() {
    const [messages, reminders] = await Promise.all([listMessages(16), listPendingReminders(6)]);
    this.publish({ messages, reminders, sessionLabel: this.prefs?.activeSession?.label ?? null });
  }


  private clearWakeHeartbeat() {
    if (this.wakeHeartbeatTimer) clearInterval(this.wakeHeartbeatTimer);
    this.wakeHeartbeatTimer = null;
  }

  private describeWakeLoop(loop: NativeSpeechLoop | null) {
    if (!loop || typeof (loop as any).getDiagnostics !== 'function') return 'wake scout: starting';
    const diagnostics = (loop as any).getDiagnostics?.() ?? {};
    this.lastWakeDiagnostics = diagnostics;
    const provider = diagnostics.provider || 'unknown';
    const listening = diagnostics.listening ? 'listening' : diagnostics.restartPending ? 'rearming' : 'idle';
    const permission = diagnostics.permission ? ` permission:${diagnostics.permission}` : '';
    const lastError = diagnostics.lastError ? ` error:${String(diagnostics.lastError).slice(0, 80)}` : '';
    const lastFinal = diagnostics.lastFinal ? ` heard:${String(diagnostics.lastFinal).slice(0, 60)}` : '';
    return `wake scout ${provider}:${listening}${permission} p${this.wakeEvents.partials}/f${this.wakeEvents.finals}/r${diagnostics.restarts ?? 0}${lastFinal}${lastError}`;
  }

  private startWakeHeartbeat(loop: NativeSpeechLoop, reason: string) {
    this.clearWakeHeartbeat();
    this.wakeHeartbeatTimer = setInterval(() => {
      if (!this.started || this.realtime || this.wakeLoop !== loop) return;
      const summary = this.describeWakeLoop(loop);
      this.publish({ speechStatus: summary, voiceSummary: summary, voiceCapability: this.lastWakeDiagnostics });
      const now = Date.now();
      if (now - this.wakeStatusLogAt > 12_000) {
        this.wakeStatusLogAt = now;
        void logEvent('wake.heartbeat', summary).catch(() => undefined);
      }
    }, numberEnv('EXPO_PUBLIC_AGA_WAKE_HEARTBEAT_MS', 2500));
    measureMark('wakeScout.heartbeat.start', { reason });
  }

  private noteWakeStatus(status: string) {
    this.wakeEvents.statuses += 1;
    const summary = `wake scout: ${status}`;
    this.publish({ speechStatus: summary });
    const now = Date.now();
    if (/unavailable|denied|missing|permission|error|started|listening/i.test(status) && now - this.wakeStatusLogAt > 1500) {
      this.wakeStatusLogAt = now;
      void logEvent('wake.status', status).catch(() => undefined);
    }
  }

  private async startWakeScout(reason: string) {
    if (this.wakeLoop || this.realtime || !this.started) return;
    this.prefs = await loadPreferences().catch(() => this.prefs);
    const locale = this.prefs?.voiceLocale || 'en-US';
    this.publish({
      ready: true,
      mode: 'sleeping',
      interim: '',
      audioLevel: 0,
      activeChoiceMenu: null,
      speechStatus: 'wake scout: starting microphone',
      error: null,
    });
    const loop = new NativeSpeechLoop(
      {
        onPartial: (text) => {
          // Local scout hears background speech, but does not execute anything until wake.
          const clean = normalizeSpeech(text);
          this.wakeEvents.partials += 1;
          this.publish({ interim: clean.slice(0, 120), speechStatus: `wake scout: hearing “${clean.slice(0, 64)}”` });
          measureMark('wakeScout.partial', { chars: text.length, partials: this.wakeEvents.partials, text: clean.slice(0, 80) });

          // Some Android/Web speech engines are slow to emit final results while
          // the room stays noisy. Wake on a partial phrase so “hey AGA” actually
          // summons her instead of waiting forever for silence.
          if (envFlag('EXPO_PUBLIC_AGA_WAKE_ON_PARTIAL', true)) {
            const wake = detectWake(clean, this.prefs?.wakePhrase || 'aga');
            if (wake.woke) void this.handleWakeFinal(clean, 'partial');
          }
        },
        onFinal: (text) => {
          this.wakeEvents.finals += 1;
          this.publish({ interim: normalizeSpeech(text).slice(0, 120), speechStatus: `wake scout: final “${normalizeSpeech(text).slice(0, 64)}”` });
          void this.handleWakeFinal(text, 'final');
        },
        onError: async (message) => {
          this.wakeEvents.errors += 1;
          this.publish({ speechStatus: `wake scout error: ${message}`, error: message });
          await logEvent('wake.error', message);
        },
        onStatus: (status) => this.noteWakeStatus(status),
      },
      locale,
    );
    this.wakeLoop = loop;
    this.wakeEvents.starts += 1;
    await logEvent('wake.starting', `reason=${reason} locale=${locale}`).catch(() => undefined);
    await loop.start({ watchdogEnabled: true }).catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error || 'wake scout failed');
      this.wakeLoop = null;
      this.publish({ speechStatus: 'wake scout failed', error: message });
      await logEvent('wake.start.error', message);
      this.scheduleWakeRetry('start_error');
    });
    const diagnostics = typeof (loop as any).getDiagnostics === 'function' ? (loop as any).getDiagnostics() : null;
    this.lastWakeDiagnostics = diagnostics;
    this.publish({ voiceSummary: this.describeWakeLoop(loop), voiceCapability: diagnostics });
    if (diagnostics?.available === false || diagnostics?.provider === 'none') {
      this.wakeLoop = null;
      const message = diagnostics?.lastError || 'Speech recognition is not available in this runtime.';
      await logEvent('wake.unavailable', message).catch(() => undefined);

      // Physical device fallback: if native/browser STT is missing but Gemini
      // duplex is selected, do not leave AGA dead. Open Gemini Live audio as
      // the wake/listening layer. This costs live-audio seconds, so it is
      // guarded by Gemini budget limits and can be disabled with
      // EXPO_PUBLIC_AGA_GEMINI_WAKELESS_DUPLEX=0.
      if (canUseWakelessGeminiDuplex()) {
        this.publish({
          speechStatus: 'local wake unavailable — starting Gemini duplex listener',
          error: envFlag('EXPO_PUBLIC_AGA_DEBUG_UI', false) ? message : null,
          voiceCapability: diagnostics,
        });
        await this.activateRealtime('__AGA_DUPLEX_STANDBY__').catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error || 'duplex fallback failed');
          this.publish({ speechStatus: 'voice fallback unavailable', error: detail });
          this.scheduleWakeRetry('duplex_fallback_failed');
        });
        return;
      }

      this.publish({
        speechStatus: envFlag('EXPO_PUBLIC_AGA_DEBUG_UI', false)
          ? `wake scout unavailable: ${message}`
          : 'voice standby: microphone wake unavailable',
        error: envFlag('EXPO_PUBLIC_AGA_DEBUG_UI', false) ? message : null,
        voiceCapability: diagnostics,
      });
      this.scheduleWakeRetry('unavailable');
      return;
    }
    this.startWakeHeartbeat(loop, reason);
    this.publish({ speechStatus: this.describeWakeLoop(loop), voiceSummary: this.describeWakeLoop(loop), voiceCapability: diagnostics });
    await logEvent('wake.started', this.describeWakeLoop(loop)).catch(() => undefined);
    measureMark('wakeScout.started', { reason, locale });
  }

  private async stopWakeScout(reason: string) {
    this.clearWakeHeartbeat();
    const loop = this.wakeLoop;
    this.wakeLoop = null;
    if (!loop) return;
    try { await loop.destroy(); }
    catch (error) { await logEvent('wake.destroy.error', error instanceof Error ? error.message : String(error)); }
    measureMark('wakeScout.stopped', { reason });
  }

  private scheduleWakeRetry(reason: string) {
    if (!this.started || this.wakeRetryTimer || this.realtime) return;
    const delay = numberEnv('EXPO_PUBLIC_AGA_WAKE_RETRY_MS', 2500);
    this.wakeRetryTimer = setTimeout(() => {
      this.wakeRetryTimer = null;
      void this.startWakeScout(`retry_${reason}`);
    }, delay);
    measureMark('wakeScout.retry.arm', { reason, delay });
  }

  private async handleWakeFinal(raw: string, source: 'partial' | 'final' = 'final') {
    const text = normalizeSpeech(raw);
    if (!text || this.wakeActivationInFlight) return;
    const prefs = await loadPreferences().catch(() => this.prefs) ?? this.prefs;
    this.prefs = prefs;
    const wakePhrase = prefs?.wakePhrase || 'aga';
    const wake = detectWake(text, wakePhrase);
    measureMark('wakeScout.final', { woke: wake.woke, kind: wake.kind, match: wake.match, source, chars: text.length, text: text.slice(0, 120) });
    if (!wake.woke) {
      if (source === 'final') this.publish({ speechStatus: `wake scout heard “${text.slice(0, 72)}” — waiting for AGA / hey AGA` });
      return;
    }

    const fingerprint = `${wake.kind}:${wake.match.toLowerCase()}:${Math.floor(Date.now() / 1500)}`;
    if (fingerprint === this.lastWakeFingerprint) return;
    this.lastWakeFingerprint = fingerprint;
    this.wakeActivationInFlight = true;

    try {
      const command = removeWakePhrase(text, wakePhrase).trim();
      this.publish({ interim: '', speechStatus: 'wake detected — connecting' });
      await logEvent('wake.accepted', `${source}/${wake.kind}: ${text.slice(0, 180)}`);
      await this.activateRealtime(command || 'The user said AGA. Greet them briefly and ask what they need.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'wake activation failed');
      this.publish({ mode: 'recovering', speechStatus: 'wake activation failed; rearming mic', error: message });
      await logEvent('wake.activate.error', message).catch(() => undefined);
      await this.sleepRealtime('wake_activate_error').catch(() => undefined);
      if (this.started) await this.startWakeScout('wake_activate_error').catch(() => undefined);
    } finally {
      setTimeout(() => { this.wakeActivationInFlight = false; }, 1000);
    }
  }

  private armIdleTimer(snapshot: RealtimeSnapshot) {
    if (this.idleTimer) clearTimeout(this.idleTimer);

    const waitingForChoice = !!snapshot.activeChoiceMenu;
    const mediaOpen = !!snapshot.activeMedia;
    const busy = snapshot.mode === 'speaking' || snapshot.mode === 'thinking' || !!snapshot.interim;
    if (waitingForChoice || busy) return;

    const delay = mediaOpen
      ? numberEnv('EXPO_PUBLIC_AGA_REALTIME_MEDIA_IDLE_MS', DEFAULT_MEDIA_IDLE_MS)
      : numberEnv('EXPO_PUBLIC_AGA_REALTIME_IDLE_MS', DEFAULT_WAKE_IDLE_MS);

    this.idleTimer = setTimeout(() => {
      void this.sleepRealtime('idle_timeout');
    }, delay);
    measureMark('realtime.idleTimer.arm', { delay, mediaOpen });
  }

  private async createSelectedVoiceSession(selectedEngine: ReturnType<typeof selectedVoiceEngine>): Promise<VoiceSessionLike> {
    // Engine firewall: when Gemini is selected, this file must not load or
    // construct the OpenAI Realtime implementation. Dynamic imports keep the
    // OpenAI transport out of the execution path unless selectedEngine=openai.
    if (selectedEngine === 'gemini') {
      const mod = await import('../gemini/GeminiLiveSession');
      return new mod.GeminiLiveSession({ onTurnDone: () => { void this.sleepRealtime('gemini_turn_done'); } });
    }
    if (selectedEngine === 'openai') {
      const mod = await import('../realtime/RealtimeSession');
      return new mod.RealtimeSession();
    }
    throw new Error(`Unsupported wake voice engine: ${selectedEngine}`);
  }

  private async activateRealtime(initialText: string) {
    return measureAsync('wakeRealtime.activate', async () => {
      if (this.realtime) {
        this.realtime.replay(initialText);
        this.armIdleTimer(this.snapshot);
        return;
      }

      if (envFlag('EXPO_PUBLIC_AGA_FRESH_CONTEXT_PER_WAKE', true)) {
        await startNewConversationSession('wake_activation', {
          clearTranscript: true,
          endActiveSession: envFlag('EXPO_PUBLIC_AGA_END_SKILL_ON_NEW_WAKE', true),
        }).catch(() => undefined);
        this.prefs = await loadPreferences().catch(() => this.prefs);
        await this.refresh().catch(() => undefined);
      }

      await this.stopWakeScout('wake_accepted');
      const selectedEngine = selectedVoiceEngine();
      this.publish({
        mode: 'awake',
        interim: '',
        speechStatus: selectedEngine === 'gemini' ? `connecting Gemini ${geminiTransportPreference() || 'text'} engine` : selectedEngine === 'openai' ? 'connecting OpenAI realtime' : 'starting local engine',
        error: null,
        voiceSummary: JSON.stringify(agaEngineDiagnostics()),
        voiceCapability: agaEngineDiagnostics(),
      });

      const session = await this.createSelectedVoiceSession(selectedEngine);
      this.realtime = session;
      this.realtimeUnsubscribe = session.subscribe((next) => {
        this.publish({ ...next, speechStatus: next.speechStatus || 'realtime active' });
        this.armIdleTimer(next);
      });

      try {
        await session.start();
        session.replay(initialText);
        this.armIdleTimer(this.snapshot);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || 'Realtime start failed');
        this.realtime = null;
        this.realtimeUnsubscribe?.();
        this.realtimeUnsubscribe = null;
        await session.stop().catch(() => undefined);
        this.publish({ mode: 'recovering', speechStatus: `${selectedVoiceEngine()} engine start failed; returning to wake scout`, error: message });
        await logEvent('realtime.start.error', message).catch(() => undefined);
        if (this.started) await this.startWakeScout('realtime_start_failed');
      }
    });
  }

  private async sleepRealtime(reason: string) {
    return measureAsync('wakeRealtime.sleepRealtime', async () => {
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this.idleTimer = null;

      const session = this.realtime;
      this.realtime = null;
      this.realtimeUnsubscribe?.();
      this.realtimeUnsubscribe = null;
      if (session) await session.stop().catch(() => undefined);
      await logEvent('realtime.sleep', reason);
      await this.refresh();
      if (this.started) await this.startWakeScout(reason);
    }, { reason });
  }

  replay(text: string) {
    const clean = normalizeSpeech(text);
    if (!clean) return;
    if (this.realtime) {
      this.realtime.replay(clean);
      return;
    }
    void this.activateRealtime(clean);
  }

  closeMedia() {
    this.realtime?.closeMedia();
  }

  onMediaEvent(event: string) {
    this.realtime?.onMediaEvent(event);
  }

  rearmMic() {
    if (this.realtime) {
      this.publish({ speechStatus: 'realtime session is already active' });
      return;
    }
    void this.stopWakeScout('manual_rearm').then(() => this.startWakeScout('manual_rearm'));
  }

  async stop() {
    this.started = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.wakeRetryTimer) clearTimeout(this.wakeRetryTimer);
    this.wakeRetryTimer = null;
    this.clearWakeHeartbeat();
    await this.stopWakeScout('stop');
    await this.sleepRealtime('stop').catch(() => undefined);
  }
}
