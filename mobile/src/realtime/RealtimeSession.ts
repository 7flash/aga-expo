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
import { buildChoiceMenu, findChoice, normalizeChoiceKey, type ChoiceMenu, type ChoiceOption, type ChoiceAction } from '../aga/choiceMenus';

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

function sessionInstructions(prefs: Preferences | null) {
  const session = prefs?.activeSession;
  if (!session) return '';
  if (session.kind === 'language') {
    return `Current session: ${session.label}. Help the user practice ${session.targetLanguage || 'the target language'}. Keep it voice-first. Correct gently after they try. Ask one short question at a time.`;
  }
  if (session.kind === 'imagination') {
    return `Current session: ${session.label}. Run a gentle imagination game in the theme ${session.theme || 'magic'}. Narrate one scene, offer 2 or 3 spoken choices, and wait for the user.`;
  }
  if (session.kind === 'advice') {
    return 'Current session: calm advice. Give short, grounded, emotionally safe guidance. Ask before going deep.';
  }
  return 'Current session: general guardian mode.';
}

function realtimeSessionConfig(prefs: Preferences | null, forUpdate = false) {
  const persona = getPersona(prefs?.persona);
  const translate = prefs?.translateTarget;
  const instructions = [
    persona.system,
    'You are AGA, a cute holographic guardian angel in a touch-free speaker. Talk naturally, briefly, and warmly.',
    'Use tools for any media, reminder, memory, persona, translation, or settings action. Do not tell the user to click or tap.',
    'When asked for YouTube or music, call play_youtube. For pause, resume, or stop playback, call media_control.',
    'Resolve relative reminder times to absolute ISO-8601 timestamps before calling set_reminder.',
    translate ? `Live translation is ON. Translate non-command user phrases into ${translate}.` : '',
    prefs?.personalityPrompt ? `Custom personality overlay: ${prefs.personalityPrompt}` : '',
    sessionInstructions(prefs),
    'When the user asks for settings, a different voice, a new personality, skills, language learning, an imagination game, or a new session, call show_settings_menu with the best category.',
    'When choices are visible and the user answers with a number or letter, call choose_option with that spoken choice. Never ask the user to tap or click.',
  ].filter(Boolean).join('\n');

  const config: Record<string, unknown> = {
    audio: {
      output: { voice: realtimeVoice(prefs) },
    },
    instructions,
    tools: TOOLS,
    tool_choice: 'auto',
  };

  // The /v1/realtime/calls WebRTC session payload is strict. Keep the initial
  // session shape close to the GA docs: type, model, audio.output.voice,
  // instructions, tools, and tool_choice. Do not put VAD at session.turn_detection
  // or legacy transcription at session.input_audio_transcription; gpt-realtime-2
  // rejects both in the Calls SDP exchange. Default server VAD is used.
  if (!forUpdate) {
    config.type = 'realtime';
    config.model = REALTIME_MODEL;
  }

  return config;
}

const TOOLS = [
  {
    type: 'function',
    name: 'remember',
    description: 'Persist a durable fact about the user for future sessions.',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    type: 'function',
    name: 'recall',
    description: 'Search saved memories. Omit query to list recent memories.',
    parameters: { type: 'object', properties: { query: { type: 'string' } } },
  },
  {
    type: 'function',
    name: 'set_reminder',
    description: 'Schedule a reminder. when_iso is an absolute ISO-8601 timestamp.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' }, when_iso: { type: 'string' } },
      required: ['text', 'when_iso'],
    },
  },
  {
    type: 'function',
    name: 'list_reminders',
    description: 'List pending reminders.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'clear_reminders',
    description: 'Delete all reminders and cancel their notifications.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'play_youtube',
    description: 'Search YouTube and start playback of the best match.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    type: 'function',
    name: 'media_control',
    description: 'Control current playback.',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string', enum: ['pause', 'resume', 'stop'] } },
      required: ['command'],
    },
  },
  {
    type: 'function',
    name: 'set_persona',
    description: 'Switch voice persona: warm, calm, bright, coach, whisper.',
    parameters: { type: 'object', properties: { persona: { type: 'string' } }, required: ['persona'] },
  },
  {
    type: 'function',
    name: 'set_translate',
    description: 'Turn live phrase translation on (target language) or off (null).',
    parameters: { type: 'object', properties: { target: { type: ['string', 'null'] } }, required: ['target'] },
  },
  {
    type: 'function',
    name: 'show_settings_menu',
    description: 'Show a spoken-choice settings/session menu. Use this for changing voice, personality, language learning, imagination games, or session modes.',
    parameters: {
      type: 'object',
      properties: { category: { type: 'string', enum: ['main', 'voice', 'personality', 'session', 'language', 'imagination', 'skills'] } },
    },
  },
  {
    type: 'function',
    name: 'choose_option',
    description: 'Choose an option from the currently visible AGA menu by number or letter.',
    parameters: { type: 'object', properties: { choice: { type: 'string' } }, required: ['choice'] },
  },
  {
    type: 'function',
    name: 'set_voice',
    description: 'Change the realtime voice directly.',
    parameters: { type: 'object', properties: { voice: { type: 'string' } }, required: ['voice'] },
  },
  {
    type: 'function',
    name: 'regenerate_personality',
    description: 'Generate or select a fresh custom personality overlay for AGA.',
    parameters: { type: 'object', properties: { style: { type: 'string' } } },
  },
  {
    type: 'function',
    name: 'start_session',
    description: 'Start a special AGA session, such as language learning, imagination game, calm advice, focus coaching, bedtime story, or general guardian mode.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['language', 'imagination', 'advice', 'general'] },
        label: { type: 'string' },
        targetLanguage: { type: 'string' },
        theme: { type: 'string' },
      },
      required: ['kind'],
    },
  },
  {
    type: 'function',
    name: 'end_session',
    description: 'End the current special session and return to normal guardian mode.',
    parameters: { type: 'object', properties: {} },
  },
] as const;

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
      await initializeLocalStore();
      this.prefs = await loadPreferences();
      this.publish({ sessionLabel: this.prefs.activeSession?.label ?? null });
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

      this.micStream = await root.navigator.mediaDevices.getUserMedia({ audio: true });
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
        measureMark('realtime.datachannel.open', { model: REALTIME_MODEL, voice: realtimeVoice(this.prefs) });
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
        const text = String(event.transcript ?? '').trim();
        if (text) {
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
        if (!this.snapshot.activeMedia) this.setMode('listening');
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
    return {
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
        return `Opening ${result.title}.`;
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
        if (!option) return `I could not match ${choice} to the visible options. Ask the user to say the number or letter again.`;
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
        action: { type: 'start_session', kind: String(kind ?? 'general') as any, label: String(label ?? kind ?? 'New session'), targetLanguage: targetLanguage ? String(targetLanguage) : undefined, theme: theme ? String(theme) : undefined },
      }),
      end_session: async () => this.applyChoice({
        key: 'end',
        label: 'End current session',
        action: { type: 'end_session' },
      }),
    };
  }

  private menuSpokenSummary(menu: ChoiceMenu) {
    const options = menu.options.map((option) => `${option.key}: ${option.label}`).join('; ');
    return `${menu.title}. ${options}. Ask the user to say the number or letter.`;
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
      this.send({ type: 'session.update', session: realtimeSessionConfig(this.prefs, true) });
      await logEvent('settings.voice', action.voice);
      return `Voice changed to ${action.label}.`;
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
    const state = String(type).includes('paused')
      ? 'paused'
      : String(type).includes('playing')
        ? 'playing'
        : String(type).includes('ended')
          ? 'stopped'
          : current.state;
    this.publish({ activeMedia: { ...current, state }, mediaCommand: null });
  }

  async stop() {
    return measureAsync('realtime.stop', async () => {
      if (this.meterTimer) clearInterval(this.meterTimer);
      this.meterTimer = null;
      this.analysers = [];
      this.connected = false;
      this.pendingSends = [];
      try { this.dc?.close?.(); } catch { /* ignore */ }
      try { this.pc?.close?.(); } catch { /* ignore */ }
      try { for (const track of this.micStream?.getTracks?.() ?? []) track.stop(); } catch { /* ignore */ }
      try { await this.audioCtx?.close?.(); } catch { /* ignore */ }
      this.dc = null;
      this.pc = null;
      this.micStream = null;
      this.audioCtx = null;
    });
  }
}
