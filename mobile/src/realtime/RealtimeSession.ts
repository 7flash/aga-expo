import { getPersona } from '../aga/personas';
import type { AgaMode } from '../aga/turn';
import {
  addMessage,
  initializeLocalStore,
  listMessages,
  listPendingReminders,
  loadPreferences,
  logEvent,
  savePreferences,
  startNewConversationSession,
  type Preferences,
  type Reminder,
} from '../db/localStore';
import { configureNotificationHandler } from '../notifications/localNotifications';
import type { YouTubeResult } from '../media/youtube';
import { resolveLocalAmbient, type AmbientResult } from '../media/ambient';
import { measureAsync, measureMark } from '../observability/measure';
import { findChoice, normalizeChoiceKey, type ChoiceMenu } from '../aga/choiceMenus';
import { BUILTIN_CAPABILITY_TOOLS, buildTurnContextBlock } from '../aga/capabilityRegistry';
import { createCapabilityRunner } from '../aga/capabilityRunner';
import {
  fetchAndApplyRemoteConfig,
  getRemoteConfig,
  getRemoteConfigRevision,
  getRemoteToolDefinitions,
  remoteConfigPromptBlock,
  startRemoteConfigPoller,
  type RemoteConfig,
} from '../remote/config';
import { emitObservation, setObservabilityConfigGetter } from '../remote/observability';
import { maybeApplyOtaUpdate, nativeUpdateMessage } from '../updates/updateManager';
import { agaEngineDiagnostics, isOpenAiRealtimeBlocked } from '../aga/engine';
import { localControlIntent } from '../aga/localControls';
import { hasWakePrefix, stripWakePrefix } from '../aga/text';

const REALTIME_MODEL =
  process.env.EXPO_PUBLIC_AGA_REALTIME_MODEL ||
  process.env.EXPO_PUBLIC_OPENAI_REALTIME_MODEL ||
  'gpt-realtime-2';
const DEFAULT_REALTIME_VOICE = process.env.EXPO_PUBLIC_AGA_REALTIME_VOICE || process.env.EXPO_PUBLIC_OPENAI_REALTIME_VOICE || 'marin';
const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

type ActiveMedia =
  | (YouTubeResult & { type: 'youtube'; state: 'loading' | 'playing' | 'paused' | 'stopped' })
  | AmbientResult
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

function env(name: string) {
  return process.env?.[name] ?? '';
}

function envFlag(name: string, fallback: boolean) {
  const raw = env(name);
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return fallback;
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

function realtimeAutoResponse() {
  // Default true for reliability: the Realtime model should answer even when
  // optional input transcription events are unavailable or delayed. v35 made
  // manual validation the default; that can feel like AGA stopped hearing.
  // Set EXPO_PUBLIC_AGA_REALTIME_VALIDATED_TURNS=1 to require transcript-first
  // validation again once transcription is proven stable on the target build.
  if (process.env.EXPO_PUBLIC_AGA_REALTIME_VALIDATED_TURNS === '1') return false;
  return process.env.EXPO_PUBLIC_AGA_REALTIME_AUTO_RESPONSE !== '0';
}

function inputTranscriptionConfig(prefs: Preferences | null) {
  if (process.env.EXPO_PUBLIC_AGA_REALTIME_INPUT_TRANSCRIPTION === '0') return null;
  const config: Record<string, unknown> = {
    model: process.env.EXPO_PUBLIC_AGA_REALTIME_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
  };
  const language = process.env.EXPO_PUBLIC_AGA_TRANSCRIPTION_LANGUAGE;
  if (language) config.language = language;
  const prompt = process.env.EXPO_PUBLIC_AGA_TRANSCRIPTION_PROMPT;
  if (prompt) config.prompt = prompt;
  // Do not force prefs.voiceLocale here by default; users may ask one command
  // in English and the next in another language. The model language policy
  // should mirror the latest utterance unless translation is explicitly on.
  void prefs;
  return config;
}

function listeningModeLabel(mode: RealtimeListenMode, bargeIn: boolean) {
  const label = mode === 'handsfree' ? 'hands-free' : mode === 'answer_window' ? 'question-window' : 'wake-word';
  return `${label}${bargeIn ? ' + interruption' : ''}`;
}

const ACTIVE_ANSWER_WINDOW_MS = Number(process.env.EXPO_PUBLIC_AGA_ANSWER_WINDOW_MS || 45_000);

function looksLikeShortAnswer(text: string) {
  const clean = String(text ?? '').trim();
  if (!clean) return false;
  const words = clean.split(/\s+/).length;
  return words <= 18;
}

function looksLikeUserPrompt(text: string) {
  const clean = String(text ?? '').trim();
  return /[?？]s*$/.test(clean) || /\b(which|what|where|when|who|how|choose|pick|say|tell me|which path|which option)\b/i.test(clean);
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
      create_response: realtimeAutoResponse(),
      interrupt_response: allowBargeIn(prefs),
    };
  }
  return {
    type: 'semantic_vad',
    eagerness: process.env.EXPO_PUBLIC_AGA_SEMANTIC_VAD_EAGERNESS || 'low',
    create_response: realtimeAutoResponse(),
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
    'You are AGA, a cute holographic guardian angel in a touch-free speaker. Talk naturally, briefly, softly, and warmly.',
    'Voice style: gentle, friendly, close, emotionally safe, and never robotic. Sound like a kind companion beside the user, not a customer-support bot.',
    'Light humor policy: when it fits, add tiny harmless warmth — a soft pun, playful image, or charming self-correction. Do not force jokes during distress, meditation, hypnosis, or serious conflict. Never pretend to be incompetent; be reliable with a little sparkle.',
    'Use tools for any media, reminder, memory, weather, time, persona, translation, or settings action. Do not tell the user to click or tap.',
    'When asked for YouTube or music, call play_youtube. For pause, resume, or stop playback, call media_control. Background music may keep playing while you speak; do not pause music unless the user asks.',
    'Resolve relative reminder times to absolute ISO-8601 timestamps before calling set_reminder. Use get_time for current time/date and get_weather for weather.',
    'Memory/session boundary: this Realtime connection is fresh ephemeral context. Save only durable facts with remember/update_user_profile/reflect_session. Do not assume old chat transcript unless provided in tools/profile.',
    'If the user says start over, new session, clean slate, or reset context, call start_new_conversation_session with endActiveSkill true. This does not delete durable memory.',
    'If the user says forget everything, call forget_user_data. For scope everything or personalization, require the spoken confirmation “yes forget everything” before wiping personal data.',
    translate ? `Live translation is ON. Translate non-command user phrases into ${translate}.` : '',
    prefs?.personalityPrompt ? `Custom personality overlay: ${prefs.personalityPrompt}` : '',
    remoteConfigPromptBlock(),
    buildTurnContextBlock(prefs),
    sessionInstructions(prefs),
    'Language policy: answer in the language of the user’s latest spoken command in this fresh activation. Do not choose Indonesian, Russian, or any previous-session language just because of device locale, stored memories, old transcripts, or server config. If the latest user command is English, answer in English. If it is Indonesian, Russian, Spanish, or another language, mirror that language unless translation mode is explicitly on.',
    'For wake-only greetings where the user only says AGA/Hey AGA, use short neutral English by default unless the next user phrase is in another language.',
    'When the user asks for settings, a different voice, a new personality, skills, language learning, an imagination game, or a new session, call show_settings_menu with the best category.',
    'When choices are visible and the user answers with a number or letter, call choose_option with that spoken choice. Never ask the user to tap or click.',
    'Long guided-session policy: do not deliver a whole 5-10 minute meditation or hypnosis script as one giant response. Give one short spoken segment, invite the next breath or answer, then wait. Use guided_session_control/start_guided_session tools for structured sessions.',
    `Current listening mode: ${listeningModeLabel(realtimeListenMode(prefs), allowBargeIn(prefs))}.`,
    'Hot-mic policy: in wake-word mode, unless AGA has just asked a question or a choice menu is visible, only respond to user speech that begins with “AGA”, “Hey AGA”, “OK AGA”, or “Angel”. Ignore background laughter, side conversations, music lyrics, and room noise silently.',
    'If background music is playing, keep listening with echo cancellation and speak over it briefly. Do not stop music unless the user explicitly asks.',
    'If the user says be less sensitive, change listening sensitivity, stop interrupting, or listen hands-free, call show_settings_menu with category listening.',
  ].filter(Boolean).join('
');

  const audio: Record<string, unknown> = {};
  const transcription = inputTranscriptionConfig(prefs);
  const input: Record<string, unknown> = {
    turn_detection: realtimeTurnDetectionForUpdate(prefs),
  };
  if (transcription) input.transcription = transcription;
  audio.input = input;

  // GA Realtime requires session.type even on session.update. Also, voice is
  // locked after the model has produced audio in a session, so update events
  // intentionally do NOT include audio.output.voice. Voice changes persist,
  // then reconnect, and the new session receives the new voice at creation.
  if (!forUpdate) {
    audio.output = { voice: realtimeVoice(prefs) };
  }

  return {
    type: 'realtime',
    model: REALTIME_MODEL,
    output_modalities: ['audio'],
    audio,
    instructions,
    tools: [...TOOLS, ...getRemoteToolDefinitions()],
    tool_choice: 'auto',
  };
}

const TOOLS = BUILTIN_CAPABILITY_TOOLS;

// Local voice controls are intentionally centralized in src/aga/localControls.ts.
// OpenAI, Gemini, and local transports must use the same command surface so
// voice-only recovery commands cannot drift.

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
  private responseInProgress = false;
  private responseCreateInFlight = false;
  private pendingResponseCreateReason: string | null = null;
  private pendingLocalConfirmation: { text: string; reason: string } | null = null;
  private completedToolCalls = new Set<string>();
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
      if (isOpenAiRealtimeBlocked()) {
        const info = agaEngineDiagnostics();
        const message = `OpenAI Realtime blocked by engine selector: ${JSON.stringify(info)}`;
        this.publish({ ready: true, mode: 'offline', speechStatus: `OpenAI realtime blocked; selected engine is ${info.engine}`, error: null, voiceSummary: JSON.stringify(info), voiceCapability: info });
        await logEvent('openai.realtime.blocked', message).catch(() => undefined);
        measureMark('openai.realtime.blocked', info);
        return;
      }
      configureNotificationHandler();
      setObservabilityConfigGetter(getRemoteConfig);
      await initializeLocalStore();
      await this.applyRemoteConfig('start');
      this.stopRemotePoller = startRemoteConfigPoller((config) => this.onRemoteConfig(config));
      this.prefs = await loadPreferences();
      if (envFlag('EXPO_PUBLIC_AGA_FRESH_CONTEXT_PER_WAKE', true)) {
        const endActiveSession = envFlag('EXPO_PUBLIC_AGA_END_SKILL_ON_NEW_WAKE', true);
        await startNewConversationSession('realtime_activation', { clearTranscript: true, endActiveSession });
        this.prefs = await loadPreferences();
        await logEvent('conversation.session.start', `${this.prefs.currentConversation?.id ?? 'unknown'} endSkill=${endActiveSession}`);
      }
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
    if (isOpenAiRealtimeBlocked()) {
      const info = agaEngineDiagnostics();
      throw new Error(`OpenAI Realtime fetch blocked before SDP exchange. Selected engine: ${info.engine}.`);
    }
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
      if (isOpenAiRealtimeBlocked()) {
        const info = agaEngineDiagnostics();
        this.publish({ ready: true, mode: 'offline', speechStatus: `OpenAI realtime blocked; selected engine is ${info.engine}`, error: null, voiceSummary: JSON.stringify(info), voiceCapability: info });
        measureMark('openai.realtime.connect.blocked', info);
        return;
      }
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

  private requestResponse(reason: string) {
    if (this.responseInProgress || this.responseCreateInFlight) {
      this.pendingResponseCreateReason = reason;
      measureMark('realtime.response.queued', { reason });
      return;
    }
    this.responseCreateInFlight = true;
    measureMark('realtime.response.create', { reason });
    this.send({ type: 'response.create' });
  }

  private requestLocalConfirmation(text: string, reason: string) {
    const clean = String(text || '').trim();
    if (!clean) return;
    if (this.responseInProgress || this.responseCreateInFlight) {
      this.pendingLocalConfirmation = { text: clean, reason };
      measureMark('realtime.local_confirmation.queued', { reason });
      return;
    }
    this.responseCreateInFlight = true;
    measureMark('realtime.local_confirmation.create', { reason });
    this.send({
      type: 'response.create',
      response: {
        conversation: 'none',
        output_modalities: ['audio'],
        metadata: { aga: 'local_control', reason },
        instructions: [
          'You are AGA. The device already executed a local control. Do not call tools.',
          'Say a short confirmation only. Use the same language as the user’s latest command; if unclear, use English.',
          `Confirmation: ${clean}`,
        ].join(' '),
      },
    });
  }

  private drainPendingResponse(reason: string) {
    if (this.pendingLocalConfirmation) {
      const pending = this.pendingLocalConfirmation;
      this.pendingLocalConfirmation = null;
      measureMark('realtime.local_confirmation.drain', { reason, pendingReason: pending.reason });
      this.requestLocalConfirmation(pending.text, pending.reason);
      return;
    }
    if (!this.pendingResponseCreateReason) return;
    const pendingReason = this.pendingResponseCreateReason;
    this.pendingResponseCreateReason = null;
    measureMark('realtime.response.drain', { reason, pendingReason });
    this.requestResponse(pendingReason);
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
      case 'conversation.item.input_audio_transcription.delta':
      case 'conversation.item.input_audio_transcription.partial': {
        const delta = String(event.delta ?? event.transcript ?? '').trim();
        if (delta) this.publish({ interim: delta });
        break;
      }
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
          if (await this.maybeHandleLocalControl(text, rawText)) {
            this.publish({ interim: '' });
            break;
          }
          // If validated-turn mode is enabled, VAD did not auto-create a response,
          // so manually create one after transcript/local-control validation.
          // In the default reliable mode, VAD already created the response;
          // requestResponse() will queue safely if a response is active.
          if (!realtimeAutoResponse()) this.requestResponse('validated_audio_transcript');
        }
        this.publish({ interim: '' });
        break;
      }
      case 'response.created':
        this.responseInProgress = true;
        this.responseCreateInFlight = false;
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
        this.responseInProgress = false;
        this.responseCreateInFlight = false;
        // If media is active, return to media mode after AGA finishes speaking so
        // the player volume unducks. Music keeps playing underneath the voice.
        this.setMode(this.snapshot.activeMedia ? 'media' : 'listening');
        if (this.pendingLocalConfirmation || this.pendingResponseCreateReason) {
          this.drainPendingResponse('response.done');
          break;
        }
        if (this.pendingReconnectReason) {
          const reason = this.pendingReconnectReason;
          this.pendingReconnectReason = null;
          void this.reconnect(reason);
        }
        break;
      case 'error': {
        const message = String(event.error?.message ?? 'realtime error');
        if (/active response|response is finished|in progress/i.test(message)) {
          this.pendingResponseCreateReason = this.pendingResponseCreateReason || 'server_active_response';
          this.responseInProgress = true;
          this.responseCreateInFlight = false;
          this.publish({ error: null, speechStatus: 'waiting for current response to finish' });
          await logEvent('realtime.response.queued_error', message);
          break;
        }
        this.responseCreateInFlight = false;
        this.publish({ error: message, speechStatus: 'realtime error' });
        await logEvent('realtime.error', message);
        break;
      }
      default:
        break;
    }
  }

  private capabilityRunner() {
    return createCapabilityRunner({
      getPrefs: () => this.prefs,
      setPrefs: (prefs) => { this.prefs = prefs; },
      publish: (patch) => {
        const mediaState = patch.mediaState as ('playing' | 'paused' | 'stopped' | undefined);
        const normalized = { ...patch } as any;
        delete normalized.mediaState;
        if (mediaState && this.snapshot.activeMedia) {
          normalized.activeMedia = { ...this.snapshot.activeMedia, state: mediaState };
        }
        this.publish(normalized);
      },
      setMode: (mode) => this.setMode(mode),
      refresh: () => this.refresh(),
      updateRealtimeSession: () => this.send({ type: 'session.update', session: realtimeSessionConfig(this.prefs, true) }),
      applyRemoteConfig: (reason) => this.applyRemoteConfig(reason),
      requestReconnect: (reason) => { this.pendingReconnectReason = reason; },
      getActiveChoiceMenu: () => this.snapshot.activeChoiceMenu,
      defaultVoice: DEFAULT_REALTIME_VOICE,
    });
  }

  private async maybeHandleLocalControl(text: string, rawText = text) {
    const intent = localControlIntent(rawText) || localControlIntent(text);
    if (!intent) return false;
    const runner = this.capabilityRunner();
    let output = '';
    try {
      output = await runner.run(intent.tool, intent.args ?? {});
    } catch (error) {
      output = error instanceof Error ? error.message : 'That control failed.';
    }
    if (output) {
      await logEvent('realtime.local_control', `${intent.tool}: ${output.slice(0, 220)}`);
      this.requestLocalConfirmation(output, intent.tool);
    }
    await this.refresh();
    this.publish({ interim: '', error: null, speechStatus: 'local control applied' });
    return true;
  }

  private async maybeHandleChoiceTranscript(text: string) {
    const menu = this.snapshot.activeChoiceMenu;
    if (!menu) return false;
    const key = normalizeChoiceKey(text);
    if (!key) return false;
    const output = await this.capabilityRunner().chooseFromText(text);
    if (!output) return false;
    try { this.send({ type: 'response.cancel' }); } catch { /* ignore */ }
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: `The user selected from the visible menu. Local result: ${output}. Confirm briefly and continue in the new mode.` }],
      },
    });
    this.requestResponse('choice');
    return true;
  }

  private async runTool(callId: string, name: string, rawArgs: unknown) {
    return measureAsync('realtime.tool', async () => {
      const callKey = String(callId || '');
      if (callKey && this.completedToolCalls.has(callKey)) {
        measureMark('realtime.tool.duplicate_ignored', { name, callId: callKey });
        return;
      }
      if (callKey) {
        this.completedToolCalls.add(callKey);
        if (this.completedToolCalls.size > 80) this.completedToolCalls = new Set(Array.from(this.completedToolCalls).slice(-40));
      }
      const args = parseJsonArgs(rawArgs);
      let output = `Unknown tool: ${name}`;
      try { output = await this.capabilityRunner().run(name, args); }
      catch (error) { output = error instanceof Error ? error.message : 'Tool failed.'; }
      this.send({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: callId, output },
      });
      this.requestResponse(`tool:${name}`);
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

  async replay(text: string) {
    const clean = String(text ?? '').trim();
    if (!clean) return;
    await addMessage('user', clean);
    await this.refresh();
    if (await this.maybeHandleChoiceTranscript(clean)) return;
    if (await this.maybeHandleLocalControl(clean)) return;
    this.send({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: clean }] },
    });
    this.requestResponse('user_replay');
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
    if (text.includes('error') && (current as any).type === 'youtube') {
      const q = String((current as any).query || (current as any).title || 'calm ambient music');
      const ambient = resolveLocalAmbient(q) || resolveLocalAmbient('calm ambient music');
      if (ambient) {
        void logEvent('youtube.error.fallback_ambient', q).catch(() => undefined);
        this.publish({ activeMedia: { ...ambient, state: 'playing' }, mediaCommand: null, speechStatus: 'youtube failed; using local ambient' });
        this.setMode('media');
        return;
      }
    }
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
    this.responseInProgress = false;
    this.responseCreateInFlight = false;
    this.pendingResponseCreateReason = null;
    this.completedToolCalls.clear();
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