import { getPersona } from '../aga/personas';
import type { AgaMode } from '../aga/turn';
import {
  addMemory,
  addMessage,
  addReminder,
  clearReminders,
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
import {
  cancelAllNotifications,
  configureNotificationHandler,
  ensureNotificationPermission,
  scheduleAgaReminderNotification,
} from '../notifications/localNotifications';
import { searchYouTube, type YouTubeResult } from '../media/youtube';
import { measureAsync, measureMark } from '../observability/measure';
import { buildChoiceMenu, findChoice, normalizeChoiceKey, type ChoiceMenu, type ChoiceOption, type ChoiceAction, type SessionKind } from '../aga/choiceMenus';
import { BUILTIN_CAPABILITY_TOOLS, buildTurnContextBlock, runGetTimeCapability, runGetWeatherCapability } from '../aga/capabilityRegistry';
import {
  executeRemoteTool,
  fetchAndApplyRemoteConfig,
  getRemoteConfig,
  getRemoteConfigRevision,
  getRemoteToolDefinitions,
  getRemoteTools,
  remoteConfigPromptBlock,
  startRemoteConfigPoller,
  type RemoteConfig,
} from '../remote/config';
import { emitObservation, setObservabilityConfigGetter } from '../remote/observability';
import { maybeApplyOtaUpdate, nativeUpdateMessage } from '../updates/updateManager';

const REALTIME_MODEL =
  process.env.EXPO_PUBLIC_AGA_REALTIME_MODEL ||
  process.env.EXPO_PUBLIC_OPENAI_REALTIME_MODEL ||
  'gpt-realtime-2';
const DEFAULT_REALTIME_VOICE = process.env.EXPO_PUBLIC_AGA_REALTIME_VOICE || process.env.EXPO_PUBLIC_OPENAI_REALTIME_VOICE || 'marin';
const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

type ActiveMedia =
  | (YouTubeResult & { type: 'youtube'; state: 'loading' | 'playing' | 'paused' | 'stopped' })
  | null;

export type RealtimeSnapshot = {
  ready: boolean;
  mode: AgaMode;
  interim: string;
  messages: Array<{ role: string; content: string; createdAt?: string }>;
  reminders: Reminder[];
  activeMedia: ActiveMedia;
  mediaCommand: 'pause' | 'resume' | 'stop' | null;
  audioLevel: number;
  speechStatus: string;
  error: string | null;
  lastMeasure?: string;
  ttsStatus?: string;
  voiceSummary?: string;
  voiceCapability?: unknown;
  activeChoiceMenu?: ChoiceMenu | null;
  sessionLabel?: string | null;
  listeningMode?: string | null;
  remoteConfigRevision?: string | null;
  deviceLabel?: string | null;
  nativeUpdateMessage?: string | null;
};

type Listener = (snapshot: RealtimeSnapshot) => void;
type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

function env(name: string) {
  return process.env?.[name] ?? '';
}

function isWebRtcAvailable() {
  const root: any = globalThis as any;
  return !!root?.RTCPeerConnection && !!root?.navigator?.mediaDevices?.getUserMedia;
}

function getRoot() {
  return globalThis as any;
}

function parseJsonArgs(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try { return JSON.parse(String(raw)); } catch { return {}; }
}

function extractToken(data: any) {
  return String(data?.client_secret?.value ?? data?.value ?? data?.token ?? data?.client_secret ?? '');
}

function realtimeVoice(prefs: Preferences | null) {
  return prefs?.realtimeVoice || DEFAULT_REALTIME_VOICE;
}

type RealtimeListenMode = 'strict' | 'answer_window' | 'handsfree';

function realtimeListenMode(prefs: Preferences | null): RealtimeListenMode {
  const raw = String((prefs as any)?.realtimeListenMode || process.env.EXPO_PUBLIC_AGA_REALTIME_LISTEN_MODE || 'strict').toLowerCase();
  if (raw === 'handsfree' || raw === 'hands-free' || raw === 'conversation') return 'handsfree';
  if (raw === 'answer_window' || raw === 'answer-window' || raw === 'question' || raw === 'question_window') return 'answer_window';
  return 'strict';
}

function allowBargeIn(prefs: Preferences | null) {
  const stored = (prefs as any)?.allowBargeIn;
  if (typeof stored === 'boolean') return stored;
  return process.env.EXPO_PUBLIC_AGA_ALLOW_BARGE_IN === '1';
}

function listeningModeLabel(mode: RealtimeListenMode, bargeIn: boolean) {
  const label = mode === 'handsfree' ? 'hands-free' : mode === 'answer_window' ? 'question-window' : 'wake-word';
  return `${label}${bargeIn ? ' + interruption' : ''}`;
}

const STRICT_WAKE_RE = /^\s*(?:hey\s+)?(?:aga|a\s*g\s*a|okay\s+aga|ok\s+aga|angel)\b[,:\s-]*/i;
const ACTIVE_ANSWER_WINDOW_MS = Number(process.env.EXPO_PUBLIC_AGA_ANSWER_WINDOW_MS || 45_000);

function hasWakePrefix(text: string) {
  return STRICT_WAKE_RE.test(String(text ?? '').trim());
}

function stripWakePrefix(text: string) {
  return String(text ?? '').replace(STRICT_WAKE_RE, '').trim();
}

function looksLikeShortAnswer(text: string) {
  const clean = String(text ?? '').trim();
  if (!clean) return false;
  const words = clean.split(/\s+/).length;
  return words <= 18;
}

function looksLikeUserPrompt(text: string) {
  const clean = String(text ?? '').trim();
  return /[?？]\s*$/.test(clean) || /\b(which|what|where|when|who|how|choose|pick|say|tell me|which path|which option)\b/i.test(clean);
}

function realtimeTurnDetectionForUpdate(prefs: Preferences | null) {
  const disabled = process.env.EXPO_PUBLIC_AGA_REALTIME_VAD === 'off';
  if (disabled) return null;
  const mode = process.env.EXPO_PUBLIC_AGA_REALTIME_VAD || 'semantic_vad';
  if (mode === 'server_vad') {
    return {
      type: 'server_vad',
      threshold: Number(process.env.EXPO_PUBLIC_AGA_VAD_THRESHOLD || 0.72),
      prefix_padding_ms: Number(process.env.EXPO_PUBLIC_AGA_VAD_PREFIX_MS || 250),
      silence_duration_ms: Number(process.env.EXPO_PUBLIC_AGA_VAD_SILENCE_MS || 650),
      create_response: true,
      interrupt_response: allowBargeIn(prefs),
    };
  }
  return {
    type: 'semantic_vad',
    eagerness: process.env.EXPO_PUBLIC_AGA_SEMANTIC_VAD_EAGERNESS || 'low',
    create_response: true,
    interrupt_response: allowBargeIn(prefs),
  };
}

function sessionInstructions(prefs: Preferences | null) {
  const session = prefs?.activeSession;
  if (!session) return '';
  if ((session as any).kind === 'remote') {
    return `Current server skill: ${session.label}. ${(session as any).instructions || ''}`;
  }
  if (session.kind === 'language') {
    return `Current session: ${session.label}. Help the user practice ${session.targetLanguage || 'the target language'}. Keep it voice-first. Correct gently after they try. Ask one short question at a time.`;
  }
  if (session.kind === 'imagination') {
    return `Current session: ${session.label}. Run a gentle imagination game in the theme ${session.theme || 'magic'}. Narrate one scene, offer 2 or 3 spoken choices, and wait for the user.`;
  }
  if (session.kind === 'advice') {
    return 'Current session: calm advice. Give short, grounded, emotionally safe guidance. Ask before going deep.';
  }
  if (session.kind === 'focus') {
    return 'Current session: focus coaching. Help the user pick one task, break it into tiny steps, and keep momentum. Ask one question at a time.';
  }
  if (session.kind === 'breathing') {
    return 'Current session: breathing guide. Speak slowly. Lead simple inhale-hold-exhale cycles, then ask how the user feels.';
  }
  if (session.kind === 'bedtime') {
    return 'Current session: bedtime story. Use soft, slow, sleep-friendly narration. Avoid suspense and loud energy.';
  }
  if (session.kind === 'music') {
    return 'Current session: music companion. Keep music playing in the background while you speak briefly over it. The UI will duck music volume while AGA talks. Offer quiet context, focus support, or gentle conversation when asked.';
  }
  return 'Current session: general guardian mode.';
}

function realtimeSessionConfig(prefs: Preferences | null, forUpdate = false) {
  const persona = getPersona(prefs?.persona);
  const translate = prefs?.translateTarget;
  const instructions = [
    persona.system,
    'You are AGA, a cute holographic guardian angel in a touch-free speaker. Talk naturally, briefly, and warmly.',
    'Use tools for any media, reminder, memory, weather, time, persona, translation, or settings action. Do not tell the user to click or tap.',
    'When asked for YouTube or music, call play_youtube. For pause, resume, or stop playback, call media_control. Background music may keep playing while you speak; do not pause music unless the user asks.',
    'Resolve relative reminder times to absolute ISO-8601 timestamps before calling set_reminder. Use get_time for current time/date and get_weather for weather.',
    translate ? `Live translation is ON. Translate non-command user phrases into ${translate}.` : '',
    prefs?.personalityPrompt ? `Custom personality overlay: ${prefs.personalityPrompt}` : '',
    remoteConfigPromptBlock(),
    buildTurnContextBlock(prefs),
    sessionInstructions(prefs),
    'When the user asks for settings, a different voice, a new personality, skills, language learning, an imagination game, or a new session, call show_settings_menu with the best category.',
    'When choices are visible and the user answers with a number or letter, call choose_option with that spoken choice. Never ask the user to tap or click.',
    `Current listening mode: ${listeningModeLabel(realtimeListenMode(prefs), allowBargeIn(prefs))}.`,
    'Hot-mic policy: in wake-word mode, unless AGA has just asked a question or a choice menu is visible, only respond to user speech that begins with “AGA”, “Hey AGA”, “OK AGA”, or “Angel”. Ignore background laughter, side conversations, music lyrics, and room noise silently.',
    'If background music is playing, keep listening with echo cancellation and speak over it briefly. Do not stop music unless the user explicitly asks.',
    'If the user says be less sensitive, change listening sensitivity, stop interrupting, or listen hands-free, call show_settings_menu with category listening.',
  ].filter(Boolean).join('\n');

  const audio: Record<string, unknown> = {
    output: { voice: realtimeVoice(prefs) },
  };

  // Keep the initial SDP payload conservative. After the data channel opens,
  // apply the stricter hot-mic/VAD policy through session.update. The GA field
  // for VAD is session.audio.input.turn_detection, not session.turn_detection.
  if (forUpdate) {
    audio.input = { turn_detection: realtimeTurnDetectionForUpdate(prefs) };
  }

  const config: Record<string, unknown> = {
    audio,
    instructions,
    tools: [...TOOLS, ...getRemoteToolDefinitions()],
    tool_choice: 'auto',
  };

  if (!forUpdate) {
    config.type = 'realtime';
    config.model = REALTIME_MODEL;
  }

  return config;
}

const TOOLS = BUILTIN_CAPABILITY_TOOLS;

export function shouldUseRealtimeSession() {
  if (env('EXPO_PUBLIC_AGA_REALTIME_ENABLED') === '0') return false;
  if (!isWebRtcAvailable()) return false;
  return !!(env('EXPO_PUBLIC_OPENAI_API_KEY') || env('EXPO_PUBLIC_AGA_REALTIME_TOKEN_URL') || env('EXPO_PUBLIC_AGA_REALTIME_SDP_URL'));
}

export class RealtimeSession {
  private listeners = new Set<Listener>();
  private pc: any | null = null;
  private dc: any | null = null;
  private micStream: any | null = null;
  private audioEl: any | null = null;
  private audioCtx: any | null = null;
  private analysers: any[] = [];
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  private prefs: Preferences | null = null;
  private assistantBuffer = '';
  private pendingSends: unknown[] = [];
  private connected = false;
  private waitingForResponseUntil = 0;
  private pendingReconnectReason: string | null = null;
  private lastGoodVoice = DEFAULT_REALTIME_VOICE;
  private stopRemotePoller: (() => void) | null = null;

  private snapshot: RealtimeSnapshot = {
    ready: false,
    mode: 'sleeping',
    interim: '',
    messages: [],
    reminders: [],
    activeMedia: null,
    mediaCommand: null,
    audioLevel: 0,
    speechStatus: 'starting realtime',
    error: null,
    activeChoiceMenu: null,
    sessionLabel: null,
    listeningMode: null,
    remoteConfigRevision: null,
    deviceLabel: null,
    nativeUpdateMessage: null,
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

  private setMode(mode: AgaMode) {
    this.publish({ mode });
  }

  async start() {
    return measureAsync('realtime.start', async () => {
      configureNotificationHandler();
      setObservabilityConfigGetter(getRemoteConfig);
      await initializeLocalStore();
      await this.applyRemoteConfig('start');
      this.stopRemotePoller = startRemoteConfigPoller((config) => this.onRemoteConfig(config));
      this.prefs = await loadPreferences();
      this.publish({
        sessionLabel: this.prefs.activeSession?.label ?? null,
        listeningMode: listeningModeLabel(realtimeListenMode(this.prefs), allowBargeIn(this.prefs)),
        remoteConfigRevision: (this.prefs as any).remoteConfigRevision ?? getRemoteConfigRevision(),
        deviceLabel: (this.prefs as any).deviceLabel ?? getRemoteConfig().deviceLabel ?? null,
        nativeUpdateMessage: nativeUpdateMessage(getRemoteConfig()),
      });
      await this.refresh();
      if (!isWebRtcAvailable()) {
        this.publish({ ready: true, mode: 'offline', speechStatus: 'realtime requires WebRTC runtime', error: null });
        return;
      }
      try {
        await this.connect();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Realtime connect failed.';
        this.publish({ ready: true, mode: 'recovering', speechStatus: 'realtime failed', error: message });
        await logEvent('realtime.connect.error', message);
      }
    });
  }


  private async applyRemoteConfig(reason: string) {
    const config = await fetchAndApplyRemoteConfig(reason);
    if (!config) return;
    this.prefs = await loadPreferences();
    this.publish({
      remoteConfigRevision: this.prefs.remoteConfigRevision ?? config.revision ?? null,
      deviceLabel: this.prefs.deviceLabel ?? config.deviceLabel ?? null,
      nativeUpdateMessage: nativeUpdateMessage(config),
      listeningMode: listeningModeLabel(realtimeListenMode(this.prefs), allowBargeIn(this.prefs)),
    });
    await maybeApplyOtaUpdate(config);
  }

  private async onRemoteConfig(config: RemoteConfig) {
    this.prefs = await loadPreferences();
    this.publish({
      remoteConfigRevision: this.prefs.remoteConfigRevision ?? config.revision ?? null,
      deviceLabel: this.prefs.deviceLabel ?? config.deviceLabel ?? null,
      nativeUpdateMessage: nativeUpdateMessage(config),
      listeningMode: listeningModeLabel(realtimeListenMode(this.prefs), allowBargeIn(this.prefs)),
    });
    emitObservation('remote_config', 'session_apply', { revision: config.revision, skills: config.skills?.length ?? 0, tools: config.tools?.length ?? 0 });
    if (this.isConnected()) {
      this.send({ type: 'session.update', session: realtimeSessionConfig(this.prefs, true) });
    }
    await maybeApplyOtaUpdate(config);
  }

  private async getEphemeralToken() {
    const tokenUrl = env('EXPO_PUBLIC_AGA_REALTIME_TOKEN_URL');
    if (!tokenUrl) return '';
    const response = await fetch(tokenUrl, { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    const token = extractToken(data);
    if (!token) throw new Error('Realtime token endpoint returned no token.');
    return token;
  }

  private async exchangeSdp(offerSdp: string) {
    const sdpRelayUrl = env('EXPO_PUBLIC_AGA_REALTIME_SDP_URL');
    if (sdpRelayUrl) {
      const response = await fetch(sdpRelayUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: offerSdp,
      });
      const answer = await response.text();
      if (!response.ok) throw new Error(`Realtime relay SDP failed: ${answer.slice(0, 180)}`);
      return answer;
    }

    const token = await this.getEphemeralToken();
    const apiKey = env('EXPO_PUBLIC_OPENAI_API_KEY');
    const credential = token || apiKey;
    if (!credential) throw new Error('Set EXPO_PUBLIC_OPENAI_API_KEY or EXPO_PUBLIC_AGA_REALTIME_TOKEN_URL.');

    let body: any = offerSdp;
    const headers: Record<string, string> = { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/sdp' };

    // Direct API-key dev mode: include session config with SDP, matching the unified WebRTC flow.
    if (!token && apiKey) {
      const FormDataCtor = getRoot().FormData;
      if (FormDataCtor) {
        const form = new FormDataCtor();
        form.set('sdp', offerSdp);
        form.set('session', JSON.stringify(realtimeSessionConfig(this.prefs)));
        body = form;
        delete headers['Content-Type'];
      }
      measureMark('realtime.using_direct_key', { model: REALTIME_MODEL });
    }

    const response = await fetch(REALTIME_CALLS_URL, { method: 'POST', headers, body });
    const answer = await response.text();
    if (!response.ok) throw new Error(`Realtime SDP exchange failed: ${answer.slice(0, 240)}`);
    return answer;
  }

  private async connect() {
    return measureAsync('realtime.connect', async () => {
      const root = getRoot();
      const pc = new root.RTCPeerConnection();
      this.pc = pc;

      if (root.document?.createElement) {
        this.audioEl = root.document.createElement('audio');
        this.audioEl.autoplay = true;
        this.audioEl.playsInline = true;
      }

      pc.ontrack = (event: any) => {
        const stream = event?.streams?.[0];
        if (this.audioEl && stream) this.audioEl.srcObject = stream;
        if (stream) this.meterStream(stream);
      };

      this.micStream = await root.navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      for (const track of this.micStream.getTracks()) pc.addTrack(track, this.micStream);
      this.meterStream(this.micStream);

      const dc = pc.createDataChannel('oai-events');
      this.dc = dc;
      dc.onopen = () => {
        this.connected = true;
        this.send({ type: 'session.update', session: realtimeSessionConfig(this.prefs, true) });
        this.flushPendingSends();
        this.publish({ ready: true, speechStatus: `realtime:${REALTIME_MODEL}`, error: null });
        this.setMode('listening');
        this.lastGoodVoice = realtimeVoice(this.prefs);
        measureMark('realtime.datachannel.open', { model: REALTIME_MODEL, voice: realtimeVoice(this.prefs), listeningMode: listeningModeLabel(realtimeListenMode(this.prefs), allowBargeIn(this.prefs)) });
      };
      dc.onmessage = (event: any) => void this.onServerEvent(event?.data);
      dc.onerror = () => this.publish({ error: 'Realtime data channel error.' });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const answer = await this.exchangeSdp(offer.sdp ?? '');
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });
      measureMark('realtime.peer.established', { model: REALTIME_MODEL });
    });
  }

  private send(payload: unknown) {
    if (this.dc?.readyState === 'open') {
      this.dc.send(JSON.stringify(payload));
      return;
    }
    this.pendingSends.push(payload);
    this.pendingSends = this.pendingSends.slice(-60);
  }

  private flushPendingSends() {
    if (this.dc?.readyState !== 'open') return;
    const pending = this.pendingSends.splice(0);
    for (const payload of pending) this.dc.send(JSON.stringify(payload));
    if (pending.length) measureMark('realtime.flushPending', { count: pending.length });
  }

  isConnected() {
    return this.connected && this.dc?.readyState === 'open';
  }

  private shouldProcessTranscript(text: string) {
    const clean = String(text ?? '').trim();
    if (!clean) return false;
    if (hasWakePrefix(clean)) return true;
    if (this.snapshot.activeChoiceMenu && findChoice(this.snapshot.activeChoiceMenu, clean)) return true;

    const listenMode = realtimeListenMode(this.prefs);
    const waiting = Date.now() < this.waitingForResponseUntil;
    if (waiting && looksLikeShortAnswer(clean)) return true;
    if (listenMode === 'answer_window' && waiting) return true;
    if (listenMode === 'handsfree') return true;

    // Legacy override for testing only.
    return process.env.EXPO_PUBLIC_AGA_STRICT_WAKE_IN_REALTIME === '0';
  }

  private async ignoreHotMicTranscript(text: string) {
    measureMark('realtime.hotmic.ignored', { chars: text.length });
    await logEvent('realtime.hotmic.ignored', text.slice(0, 180));
    this.publish({ interim: '', speechStatus: this.snapshot.activeMedia ? 'music + wake listening' : 'wake listening' });
    // If the model started a response due to VAD, cancel it. With
    // interrupt_response=false this should be rare, but it protects against
    // laughter/music/side-talk starting unwanted turns.
    this.send({ type: 'response.cancel' });
    this.send({ type: 'input_audio_buffer.clear' });
  }

  private async onServerEvent(raw: string) {
    let event: any;
    try { event = JSON.parse(raw); } catch { return; }
    measureMark('realtime.event', { type: event.type });

    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        this.publish({ interim: '' });
        this.setMode('listening');
        break;
      case 'conversation.item.input_audio_transcription.completed':
      case 'conversation.item.input_audio_transcription.done': {
        const rawText = String(event.transcript ?? '').trim();
        if (rawText) {
          if (!this.shouldProcessTranscript(rawText)) {
            await this.ignoreHotMicTranscript(rawText);
            break;
          }
          const text = hasWakePrefix(rawText) ? stripWakePrefix(rawText) || rawText : rawText;
          await addMessage('user', text);
          await logEvent('realtime.user', text);
          await this.refresh();
          if (await this.maybeHandleChoiceTranscript(text)) {
            this.publish({ interim: '' });
            break;
          }
        }
        this.publish({ interim: '' });
        break;
      }
      case 'response.created':
        this.assistantBuffer = '';
        this.setMode('thinking');
        break;
      case 'response.audio_transcript.delta':
      case 'response.output_audio_transcript.delta':
      case 'response.output_text.delta':
        this.assistantBuffer += String(event.delta ?? '');
        this.publish({ interim: this.assistantBuffer });
        this.setMode('speaking');
        break;
      case 'response.audio_transcript.done':
      case 'response.output_audio_transcript.done':
      case 'response.output_text.done': {
        const text = String(event.transcript ?? event.text ?? this.assistantBuffer).trim();
        if (text) {
          await addMessage('assistant', text);
          this.waitingForResponseUntil = looksLikeUserPrompt(text) ? Date.now() + ACTIVE_ANSWER_WINDOW_MS : 0;
          await this.refresh();
        }
        this.assistantBuffer = '';
        this.publish({ interim: '' });
        break;
      }
      case 'response.function_call_arguments.done':
        await this.runTool(event.call_id, event.name, event.arguments);
        break;
      case 'response.output_item.done':
        if (event.item?.type === 'function_call') {
          await this.runTool(event.item.call_id, event.item.name, event.item.arguments);
        }
        break;
      case 'response.done':
        // If media is active, return to media mode after AGA finishes speaking so
        // the player volume unducks. Music keeps playing underneath the voice.
        this.setMode(this.snapshot.activeMedia ? 'media' : 'listening');
        if (this.pendingReconnectReason) {
          const reason = this.pendingReconnectReason;
          this.pendingReconnectReason = null;
          void this.reconnect(reason);
        }
        break;
      case 'error': {
        const message = String(event.error?.message ?? 'realtime error');
        this.publish({ error: message, speechStatus: 'realtime error' });
        await logEvent('realtime.error', message);
        break;
      }
      default:
        break;
    }
  }

  private toolHandlers(): Record<string, ToolHandler> {
    const handlers: Record<string, ToolHandler> = {
      get_time: async (args) => runGetTimeCapability(args),
      get_weather: async (args) => runGetWeatherCapability(args, this.prefs),
      remember: async ({ text }) => {
        await addMemory(String(text ?? ''));
        await logEvent('memory.add', String(text ?? ''));
        await this.refresh();
        return `Saved: ${text}`;
      },
      recall: async ({ query }) => {
        const found = await searchMemories(query ? String(query) : undefined, 6);
        return found.length ? found.map((memory) => memory.text).join('; ') : 'No memories yet.';
      },
      set_reminder: async ({ text, when_iso }) => {
        const dueAt = String(when_iso ?? new Date(Date.now() + 60_000).toISOString());
        const notificationId = await scheduleAgaReminderNotification({
          body: String(text ?? ''),
          dueAt,
          data: { kind: 'aga.reminder' },
        }).catch(() => null);
        const reminder = await addReminder(String(text ?? ''), dueAt, notificationId);
        await ensureNotificationPermission();
        await logEvent('reminder.add', `${reminder.text} @ ${dueAt}${notificationId ? ` n=${notificationId}` : ''}`);
        await this.refresh();
        return `Reminder set for ${new Date(dueAt).toLocaleString()}.`;
      },
      list_reminders: async () => {
        const pending = await listPendingReminders(8);
        return pending.length ? pending.map((reminder) => `${reminder.text} (${reminder.dueAt})`).join('; ') : 'No pending reminders.';
      },
      clear_reminders: async () => {
        await clearReminders();
        await cancelAllNotifications();
        await this.refresh();
        return 'All reminders cleared.';
      },
      play_youtube: async ({ query }) => {
        const q = String(query ?? 'music').trim() || 'music';
        this.publish({ activeMedia: { type: 'youtube', videoId: '', title: q, url: '', thumbnailUrl: null, query: q, state: 'loading' } as ActiveMedia });
        this.setMode('media');
        const result = await searchYouTube(q);
        this.publish({ activeMedia: { ...result, type: 'youtube', state: 'playing' }, mediaCommand: null });
        await logEvent('youtube.play', `${result.title} ${result.url}`);
        await this.refresh();
        return `Playing ${result.title}. I can still speak over the music; say pause, resume, or close video any time.`;
      },
      media_control: async ({ command }) => {
        const cmd = String(command ?? '') as 'pause' | 'resume' | 'stop';
        if (cmd === 'stop') {
          this.publish({ activeMedia: null, mediaCommand: 'stop' });
          this.setMode('listening');
          return 'Stopped playback.';
        }
        const state = cmd === 'pause' ? 'paused' : 'playing';
        this.publish({
          mediaCommand: cmd,
          activeMedia: this.snapshot.activeMedia ? { ...this.snapshot.activeMedia, state } : null,
        });
        return cmd === 'pause' ? 'Paused.' : 'Resuming.';
      },
      set_listening_mode: async ({ mode, allow_barge_in }) => {
        const raw = String(mode ?? 'strict').toLowerCase();
        const nextMode: RealtimeListenMode = raw === 'handsfree' ? 'handsfree' : raw === 'answer_window' ? 'answer_window' : 'strict';
        const nextBargeIn = typeof allow_barge_in === 'boolean' ? allow_barge_in : allowBargeIn(this.prefs);
        this.prefs = await savePreferences({ realtimeListenMode: nextMode, allowBargeIn: nextBargeIn } as Partial<Preferences>);
        this.publish({ listeningMode: listeningModeLabel(nextMode, nextBargeIn) });
        this.send({ type: 'session.update', session: realtimeSessionConfig(this.prefs, true) });
        await logEvent('settings.listening', listeningModeLabel(nextMode, nextBargeIn));
        return `Listening mode set to ${listeningModeLabel(nextMode, nextBargeIn)}.`;
      },
      refresh_remote_config: async () => {
        await this.applyRemoteConfig('tool');
        return `Pulled server configuration revision ${getRemoteConfigRevision()}.`;
      },
      set_persona: async ({ persona }) => {
        this.prefs = await savePreferences({ persona: String(persona ?? 'warm') });
        this.send({ type: 'session.update', session: realtimeSessionConfig(this.prefs, true) });
        await logEvent('prefs.persona', String(persona ?? ''));
        return `Persona set to ${persona}.`;
      },
      set_translate: async ({ target }) => {
        const value = target == null ? null : String(target);
        this.prefs = await savePreferences({ translateTarget: value });
        this.send({ type: 'session.update', session: realtimeSessionConfig(this.prefs, true) });
        this.setMode(value ? 'translating' : 'listening');
        return value ? `Translating to ${value}.` : 'Translation off.';
      },
      show_settings_menu: async ({ category }) => {
        const menu = buildChoiceMenu(String(category ?? 'main'));
        this.publish({ activeChoiceMenu: menu });
        await logEvent('settings.menu', menu.id);
        return this.menuSpokenSummary(menu);
      },
      choose_option: async ({ choice }) => {
        const option = findChoice(this.snapshot.activeChoiceMenu, String(choice ?? ''));
        if (!option) return `I could not match ${choice} to the visible options. Say the number, letter, or option name again.`;
        return this.applyChoice(option);
      },
      set_voice: async ({ voice }) => this.applyChoice({
        key: 'voice',
        label: String(voice ?? DEFAULT_REALTIME_VOICE),
        action: { type: 'set_voice', voice: String(voice ?? DEFAULT_REALTIME_VOICE), label: String(voice ?? DEFAULT_REALTIME_VOICE) },
      }),
      regenerate_personality: async ({ style }) => this.applyChoice({
        key: 'personality',
        label: 'Regenerated personality',
        action: { type: 'regenerate_personality', style: String(style ?? 'fresh guardian blend'), label: 'Regenerated personality' },
      }),
      start_session: async ({ kind, label, targetLanguage, theme }) => this.applyChoice({
        key: 'session',
        label: String(label ?? kind ?? 'New session'),
        action: { type: 'start_session', kind: String(kind ?? 'general') as SessionKind, label: String(label ?? kind ?? 'New session'), targetLanguage: targetLanguage ? String(targetLanguage) : undefined, theme: theme ? String(theme) : undefined },
      }),
      end_session: async () => this.applyChoice({
        key: 'end',
        label: 'End current session',
        action: { type: 'end_session' },
      }),
    };
    for (const tool of getRemoteTools()) {
      handlers[tool.name] = async (args) => executeRemoteTool(tool.name, args, {
        deviceLabel: (this.prefs as any)?.deviceLabel,
        revision: getRemoteConfigRevision(),
        activeSession: this.prefs?.activeSession ?? null,
      });
    }
    return handlers;
  }

  private menuSpokenSummary(menu: ChoiceMenu) {
    const options = menu.options.map((option) => `${option.key}: ${option.label}`).join('; ');
    return `${menu.title}. ${options}. Say the number, letter, or option name.`;
  }

  private async maybeHandleChoiceTranscript(text: string) {
    const menu = this.snapshot.activeChoiceMenu;
    if (!menu) return false;
    const key = normalizeChoiceKey(text);
    if (!key) return false;
    const option = findChoice(menu, text);
    if (!option) return false;
    try { this.send({ type: 'response.cancel' }); } catch { /* ignore */ }
    const output = await this.applyChoice(option);
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: `The user selected option ${option.key}: ${option.label}. Local result: ${output}. Confirm briefly and continue in the new mode.` }],
      },
    });
    this.send({ type: 'response.create' });
    return true;
  }

  private generatedPersonality(style: string) {
    const clean = String(style || 'fresh guardian blend').trim();
    return `Personality overlay: AGA is a ${clean}. Keep replies short, warm, curious, and voice-first. Offer choices when changing modes. Never mention buttons, tapping, or text input.`;
  }

  private async applyChoice(option: ChoiceOption): Promise<string> {
    const action = option.action as ChoiceAction;
    if (action.type === 'show_menu') {
      const menu = buildChoiceMenu(action.menu);
      this.publish({ activeChoiceMenu: menu });
      await logEvent('settings.menu', menu.id);
      return this.menuSpokenSummary(menu);
    }

    this.publish({ activeChoiceMenu: null });

    if (action.type === 'set_voice') {
      this.prefs = await savePreferences({ realtimeVoice: action.voice });
      // Some Realtime voices are effectively fixed at session start in WebRTC.
      // Persist immediately, update the live session best-effort, then restart
      // after the confirmation finishes so the next response is definitely the
      // selected voice.
      this.send({ type: 'session.update', session: realtimeSessionConfig(this.prefs, true) });
      this.pendingReconnectReason = `voice:${action.voice}`;
      this.publish({ speechStatus: `voice set: ${action.label}` });
      await logEvent('settings.voice', action.voice);
      return `Voice changed to ${action.label}. I will use it from my next reply.`;
    }

    if (action.type === 'set_persona') {
      this.prefs = await savePreferences({ persona: action.persona, personalityPrompt: null });
      this.send({ type: 'session.update', session: realtimeSessionConfig(this.prefs, true) });
      await logEvent('settings.persona', action.persona);
      return `Personality changed to ${action.label}.`;
    }

    if (action.type === 'regenerate_personality') {
      const prompt = this.generatedPersonality(action.style);
      this.prefs = await savePreferences({ personalityPrompt: prompt });
      this.send({ type: 'session.update', session: realtimeSessionConfig(this.prefs, true) });
      await logEvent('settings.personality.regenerate', action.style);
      return 'I regenerated my personality blend for this device.';
    }

    if (action.type === 'start_remote_skill') {
      const activeSession = {
        kind: 'remote' as SessionKind,
        label: action.label,
        skillId: action.skillId,
        instructions: action.instructions,
        targetLanguage: action.targetLanguage ?? null,
        theme: action.theme ?? null,
        iconUrl: action.iconUrl ?? null,
        imageUrl: action.imageUrl ?? null,
        toolNames: action.toolNames ?? [],
        startedAt: new Date().toISOString(),
      };
      this.prefs = await savePreferences({ activeSession } as Partial<Preferences>);
      this.publish({ sessionLabel: activeSession.label });
      this.send({ type: 'session.update', session: realtimeSessionConfig(this.prefs, true) });
      await logEvent('settings.remote_skill.start', `${action.skillId}: ${action.label}`);
      return `Starting ${activeSession.label}.`;
    }

    if (action.type === 'start_session') {
      const activeSession = {
        kind: action.kind,
        label: action.label,
        targetLanguage: action.targetLanguage ?? null,
        theme: action.theme ?? null,
        startedAt: new Date().toISOString(),
      };
      this.prefs = await savePreferences({ activeSession });
      this.publish({ sessionLabel: activeSession.label });
      this.send({ type: 'session.update', session: realtimeSessionConfig(this.prefs, true) });
      await logEvent('settings.session.start', activeSession.label);
      return `Starting ${activeSession.label}.`;
    }

    if (action.type === 'end_session') {
      this.prefs = await savePreferences({ activeSession: null });
      this.publish({ sessionLabel: null });
      this.send({ type: 'session.update', session: realtimeSessionConfig(this.prefs, true) });
      return 'Session ended. Back to normal guardian mode.';
    }

    if (action.type === 'set_listening_mode') {
      this.prefs = await savePreferences({ realtimeListenMode: action.mode, allowBargeIn: !!action.allowBargeIn } as Partial<Preferences>);
      this.publish({ listeningMode: listeningModeLabel(action.mode, !!action.allowBargeIn) });
      this.send({ type: 'session.update', session: realtimeSessionConfig(this.prefs, true) });
      await logEvent('settings.listening', listeningModeLabel(action.mode, !!action.allowBargeIn));
      return `Listening mode set to ${listeningModeLabel(action.mode, !!action.allowBargeIn)}.`;
    }

    return 'Done.';
  }

  private async runTool(callId: string, name: string, rawArgs: unknown) {
    return measureAsync('realtime.tool', async () => {
      const args = parseJsonArgs(rawArgs);
      const handler = this.toolHandlers()[name];
      let output = `Unknown tool: ${name}`;
      if (handler) {
        try { output = await handler(args); }
        catch (error) { output = error instanceof Error ? error.message : 'Tool failed.'; }
      }
      this.send({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: callId, output },
      });
      this.send({ type: 'response.create' });
    }, { name });
  }

  private meterStream(stream: any) {
    try {
      const root = getRoot();
      const AudioContextCtor = root.AudioContext || root.webkitAudioContext;
      if (!AudioContextCtor) return;
      if (!this.audioCtx) this.audioCtx = new AudioContextCtor();
      const source = this.audioCtx.createMediaStreamSource(stream);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      this.analysers.push(analyser);
      if (!this.meterTimer) {
        const buf = new Uint8Array(analyser.fftSize);
        this.meterTimer = setInterval(() => {
          let peak = 0;
          for (const node of this.analysers) {
            node.getByteTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i += 1) {
              const v = (buf[i] - 128) / 128;
              sum += v * v;
            }
            peak = Math.max(peak, Math.sqrt(sum / buf.length));
          }
          const audioLevel = Math.min(1, peak * 2.4);
          if (Math.abs(audioLevel - this.snapshot.audioLevel) > 0.02) this.publish({ audioLevel });
        }, 60);
      }
    } catch {
      // Metering is best-effort; the angel still animates without it.
    }
  }

  private async refresh() {
    const [messages, reminders] = await Promise.all([listMessages(16), listPendingReminders(6)]);
    this.publish({ messages, reminders });
  }

  replay(text: string) {
    const clean = String(text ?? '').trim();
    if (!clean) return;
    this.send({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: clean }] },
    });
    this.send({ type: 'response.create' });
  }

  rearmMic() {
    this.publish({ speechStatus: 'realtime already listens continuously' });
  }

  closeMedia() {
    this.publish({ activeMedia: null, mediaCommand: 'stop' });
    this.setMode('listening');
  }

  onMediaEvent(raw: string) {
    let type = raw;
    try { type = JSON.parse(raw)?.type ?? raw; } catch { /* keep raw */ }
    const current = this.snapshot.activeMedia;
    if (!current) return;

    const text = String(type);
    // Lifecycle events such as player.mount/load do not change media state.
    // Publishing a cloned activeMedia object for these events causes React
    // render loops when the iframe remounts or reports readiness.
    if (text.includes('mount') || text.includes('load') || text.includes('ready') || text.includes('buffering')) {
      if (this.snapshot.mediaCommand !== null) this.publish({ mediaCommand: null });
      return;
    }

    const state = text.includes('paused') || text.includes('pause')
      ? 'paused'
      : text.includes('playing') || text.includes('resume')
        ? 'playing'
        : text.includes('ended') || text.includes('stop')
          ? 'stopped'
          : current.state;

    if (state === current.state && this.snapshot.mediaCommand === null) return;
    if (state === 'stopped') {
      this.publish({ activeMedia: null, mediaCommand: null });
      this.setMode('listening');
      return;
    }
    this.publish({ activeMedia: { ...current, state }, mediaCommand: null });
  }

  private async teardownPeer(clearPending = false) {
    if (this.meterTimer) clearInterval(this.meterTimer);
    this.meterTimer = null;
    this.analysers = [];
    this.connected = false;
    if (clearPending) this.pendingSends = [];
    try { this.dc?.close?.(); } catch { /* ignore */ }
    try { this.pc?.close?.(); } catch { /* ignore */ }
    try { for (const track of this.micStream?.getTracks?.() ?? []) track.stop(); } catch { /* ignore */ }
    try { await this.audioCtx?.close?.(); } catch { /* ignore */ }
    this.dc = null;
    this.pc = null;
    this.micStream = null;
    this.audioCtx = null;
  }

  private async reconnect(reason: string) {
    return measureAsync('realtime.reconnect', async () => {
      this.publish({ speechStatus: `restarting realtime: ${reason}`, mode: 'recovering' });
      await this.teardownPeer(false);
      try {
        await this.connect();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Reconnect failed.';
        await logEvent('realtime.reconnect.error', `${reason}: ${message}`);
        if (reason.startsWith('voice:')) {
          this.prefs = await savePreferences({ realtimeVoice: this.lastGoodVoice } as Partial<Preferences>);
          this.publish({ speechStatus: `voice reverted: ${this.lastGoodVoice}`, error: message });
          await this.connect().catch((secondError) => {
            const fallbackMessage = secondError instanceof Error ? secondError.message : 'Fallback reconnect failed.';
            this.publish({ mode: 'recovering', speechStatus: 'realtime reconnect failed', error: fallbackMessage });
          });
          return;
        }
        this.publish({ mode: 'recovering', speechStatus: 'realtime reconnect failed', error: message });
      }
    }, { reason });
  }

  async stop() {
    return measureAsync('realtime.stop', async () => {
      if (this.stopRemotePoller) this.stopRemotePoller();
      this.stopRemotePoller = null;
      await this.teardownPeer(true);
    });
  }
}
