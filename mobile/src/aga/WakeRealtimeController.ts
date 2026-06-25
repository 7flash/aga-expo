import { NativeSpeechLoop } from '../voice/nativeSpeech';
import { loadPreferences, initializeLocalStore, listMessages, listPendingReminders, logEvent, type Preferences } from '../db/localStore';
import { detectWake, removeWakePhrase, normalizeSpeech } from './text';
import { measureAsync, measureMark } from '../observability/measure';
import { RealtimeSession, type RealtimeSnapshot } from '../realtime/RealtimeSession';

const DEFAULT_WAKE_IDLE_MS = 45_000;
const DEFAULT_MEDIA_IDLE_MS = 5 * 60_000;

function env(name: string) {
  return process.env?.[name] ?? '';
}

function numberEnv(name: string, fallback: number) {
  const raw = Number(env(name));
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

type Listener = (snapshot: RealtimeSnapshot) => void;

/**
 * Product voice lifecycle:
 * 1. Always-on local wake scout listens only for “AGA” / configured wake phrase.
 * 2. After wake, start a full-duplex gpt-realtime session.
 * 3. Keep it open while the user is talking, choosing menus, or controlling media.
 * 4. When idle for a while, close Realtime and return to the local wake scout.
 *
 * This preserves privacy/cost/battery while still giving natural duplex speech once summoned.
 */
export class WakeRealtimeController {
  private listeners = new Set<Listener>();
  private wakeLoop: NativeSpeechLoop | null = null;
  private realtime: RealtimeSession | null = null;
  private realtimeUnsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private prefs: Preferences | null = null;
  private started = false;

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
      await this.refresh();
      await this.startWakeScout('initial');
    });
  }

  private async refresh() {
    const [messages, reminders] = await Promise.all([listMessages(16), listPendingReminders(6)]);
    this.publish({ messages, reminders, sessionLabel: this.prefs?.activeSession?.label ?? null });
  }

  private async startWakeScout(reason: string) {
    if (this.wakeLoop || this.realtime) return;
    const locale = this.prefs?.voiceLocale || 'en-US';
    this.publish({
      ready: true,
      mode: 'sleeping',
      interim: '',
      audioLevel: 0,
      activeChoiceMenu: null,
      speechStatus: 'wake scout: listening for AGA',
      error: null,
    });
    const loop = new NativeSpeechLoop(
      {
        onPartial: (text) => {
          // Local scout hears background speech, but does not execute anything until wake.
          this.publish({ interim: normalizeSpeech(text).slice(0, 120), speechStatus: 'wake scout: hearing' });
          measureMark('wakeScout.partial', { chars: text.length });
        },
        onFinal: (text) => void this.handleWakeFinal(text),
        onError: async (message) => {
          this.publish({ speechStatus: `wake scout error: ${message}`, error: message });
          await logEvent('wake.error', message);
        },
        onStatus: (status) => this.publish({ speechStatus: `wake scout: ${status}` }),
      },
      locale,
    );
    this.wakeLoop = loop;
    await loop.start({ watchdogEnabled: true }).catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error || 'wake scout failed');
      this.publish({ speechStatus: 'wake scout failed', error: message });
      await logEvent('wake.start.error', message);
    });
    measureMark('wakeScout.started', { reason, locale });
  }

  private async stopWakeScout(reason: string) {
    const loop = this.wakeLoop;
    this.wakeLoop = null;
    if (!loop) return;
    try { await loop.destroy(); }
    catch (error) { await logEvent('wake.destroy.error', error instanceof Error ? error.message : String(error)); }
    measureMark('wakeScout.stopped', { reason });
  }

  private async handleWakeFinal(raw: string) {
    const text = normalizeSpeech(raw);
    if (!text) return;
    const prefs = this.prefs ?? await loadPreferences();
    this.prefs = prefs;
    const wake = detectWake(text, prefs.wakePhrase);
    measureMark('wakeScout.final', { woke: wake.woke, kind: wake.kind, chars: text.length });
    if (!wake.woke) {
      this.publish({ interim: '', speechStatus: 'wake scout: waiting for AGA' });
      return;
    }

    const command = removeWakePhrase(text, prefs.wakePhrase).trim();
    await logEvent('wake.accepted', `${wake.kind}: ${text.slice(0, 180)}`);
    await this.activateRealtime(command || 'The user said AGA. Greet them briefly and ask what they need.');
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

  private async activateRealtime(initialText: string) {
    return measureAsync('wakeRealtime.activate', async () => {
      if (this.realtime) {
        this.realtime.replay(initialText);
        this.armIdleTimer(this.snapshot);
        return;
      }

      await this.stopWakeScout('wake_accepted');
      this.publish({ mode: 'awake', interim: '', speechStatus: 'connecting realtime', error: null });

      const session = new RealtimeSession();
      this.realtime = session;
      this.realtimeUnsubscribe = session.subscribe((next) => {
        this.publish({ ...next, speechStatus: next.speechStatus || 'realtime active' });
        this.armIdleTimer(next);
      });

      await session.start();
      session.replay(initialText);
      this.armIdleTimer(this.snapshot);
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
    await this.stopWakeScout('stop');
    await this.sleepRealtime('stop').catch(() => undefined);
  }
}
