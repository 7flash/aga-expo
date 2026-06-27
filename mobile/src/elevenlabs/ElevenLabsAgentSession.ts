import type { AgaMode } from '../aga/turn';
import type { VoiceTransport, VoiceTransportSnapshot, VoiceTransportListener } from '../voice/VoiceTransport';
import {
  addMessage,
  initializeLocalStore,
  listMessages,
  listPendingReminders,
  loadPreferences,
  logEvent,
  type Preferences,
} from '../db/localStore';
import { AGA_CONFIG } from '../config/agaConfig';
import { buildTurnContextBlock } from '../aga/capabilityRegistry';
import { remoteConfigPromptBlock } from '../remote/config';

const DEFAULT_WS_BASE = 'wss://api.elevenlabs.io/v1/convai/conversation';

type QueuedMessage = Record<string, unknown>;

type Options = {
  onTurnDone?: () => void;
};

function nowIso() {
  return new Date().toISOString();
}

function env(name: string) {
  return String(process.env?.[name] ?? '').trim();
}

function envFlag(name: string, fallback = false) {
  const raw = env(name).toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

function getRoot() {
  return globalThis as any;
}

function getWebSocketCtor(): typeof WebSocket {
  const root = getRoot();
  if (!root.WebSocket) throw new Error('WebSocket is not available on this platform.');
  return root.WebSocket;
}

function isSocketOpen(socket: WebSocket | null) {
  return !!socket && socket.readyState === WebSocket.OPEN;
}

function base64FromBytes(bytes: Uint8Array) {
  const root = getRoot();
  if (root.Buffer) return root.Buffer.from(bytes).toString('base64');
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return root.btoa(binary);
}

function bytesFromBase64(base64: string) {
  const root = getRoot();
  if (root.Buffer) return new Uint8Array(root.Buffer.from(base64, 'base64'));
  const binary = root.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function pcm16Base64FromFloat32(input: Float32Array, inputSampleRate: number, outputSampleRate: number) {
  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const bytes = new Uint8Array(outputLength * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = Math.min(input.length - 1, Math.floor(i * ratio));
    const clamped = Math.max(-1, Math.min(1, input[sourceIndex] || 0));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return base64FromBytes(bytes);
}

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function agentInstructions(prefs: Preferences | null) {
  return [
    'You are AGA, an artificial guardian angel in a behind-glass voice appliance.',
    'The interface is voice-only. Never tell the user to tap, click, type, or look at a screen.',
    'Keep casual replies short, warm, direct, and emotionally present. Ask at most one question at a time.',
    'For local controls, menus, YouTube, settings, memories, reminders, and deterministic guided sessions, the AGA router may handle the action before the agent sees the turn.',
    'Mirror the language of the latest user utterance. Default to English only when unclear.',
    prefs?.personalityPrompt ? `Custom personality overlay: ${prefs.personalityPrompt}` : '',
    remoteConfigPromptBlock(),
    buildTurnContextBlock(prefs),
  ].filter(Boolean).join('\n');
}

export class ElevenLabsAgentSession implements VoiceTransport {
  readonly name = 'elevenlabs_agent';

  private listeners = new Set<VoiceTransportListener>();
  private socket: WebSocket | null = null;
  private queue: QueuedMessage[] = [];
  private prefs: Preferences | null = null;
  private options: Options;
  private mediaStream: MediaStream | null = null;
  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private nextPlaybackTime = 0;
  private agentTextBuffer = '';
  private seenEventIds = new Set<string>();

  private snapshot: VoiceTransportSnapshot = {
    ready: false,
    mode: 'sleeping' as AgaMode,
    interim: '',
    messages: [],
    reminders: [],
    activeMedia: null,
    mediaCommand: null,
    audioLevel: 0,
    speechStatus: 'ElevenLabs Agent idle',
    error: null,
    activeChoiceMenu: null,
    sessionLabel: 'ElevenLabs Agent',
  };

  constructor(options: Options = {}) {
    this.options = options;
  }

  subscribe(listener: VoiceTransportListener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  private publish(patch: Partial<VoiceTransportSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  async start() {
    await initializeLocalStore();
    this.prefs = await loadPreferences();
    await this.refresh();
    const url = await this.resolveConversationUrl();
    const WebSocketCtor = getWebSocketCtor();
    this.publish({ mode: 'thinking', speechStatus: 'ElevenLabs Agent connecting', error: null, sessionLabel: 'ElevenLabs Agent' });
    const socket = new WebSocketCtor(url);
    this.socket = socket;

    socket.onopen = () => {
      this.publish({ ready: true, mode: 'listening', speechStatus: 'ElevenLabs Agent connected', error: null });
      this.sendInitiationData();
      this.flushQueue();
      if (AGA_CONFIG.elevenLabsAgent.websocketAudio) void this.startMicrophoneBridge().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.publish({ speechStatus: 'ElevenLabs text-turn bridge active', error: message });
        void logEvent('elevenlabs_agent.mic_bridge_unavailable', message).catch(() => undefined);
      });
      void logEvent('elevenlabs_agent.connect', AGA_CONFIG.elevenLabsAgent.agentId || 'signed_url').catch(() => undefined);
    };

    socket.onmessage = (event) => this.handleSocketMessage(event.data);
    socket.onerror = (event) => {
      this.publish({ mode: 'recovering', speechStatus: 'ElevenLabs Agent socket error', error: JSON.stringify(event) });
    };
    socket.onclose = () => {
      this.publish({ ready: false, mode: 'sleeping', speechStatus: 'ElevenLabs Agent disconnected' });
      this.stopMicrophoneBridge();
      this.options.onTurnDone?.();
    };
  }

  async stop() {
    this.stopMicrophoneBridge();
    this.queue = [];
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState <= 1) socket.close();
    this.publish({ ready: false, mode: 'sleeping', speechStatus: 'ElevenLabs Agent stopped', interim: '' });
    await logEvent('elevenlabs_agent.stop', 'stopped').catch(() => undefined);
  }

  async replay(text: string) {
    const clean = cleanText(text);
    if (!clean) return;
    await addMessage('user', clean).catch(() => undefined);
    await this.refresh();
    this.publish({ mode: 'thinking', interim: '', speechStatus: 'sent to ElevenLabs Agent' });
    this.sendOrQueue({ type: 'user_message', text: clean });
  }

  async onTurnText(text: string) {
    await this.replay(text);
  }

  closeMedia() {
    this.publish({ activeMedia: null, mediaCommand: 'stop' });
  }

  rearmMic() {
    if (!this.mediaStream && isSocketOpen(this.socket) && AGA_CONFIG.elevenLabsAgent.websocketAudio) {
      return this.startMicrophoneBridge();
    }
  }

  private async refresh() {
    const [messages, reminders] = await Promise.all([
      listMessages(12).catch(() => []),
      listPendingReminders(8).catch(() => []),
    ]);
    this.publish({ messages, reminders } as any);
  }

  private async resolveConversationUrl() {
    const { signedUrlEndpoint, agentId, environment, branchId } = AGA_CONFIG.elevenLabsAgent;
    if (signedUrlEndpoint) {
      const url = new URL(signedUrlEndpoint, getRoot().location?.href || 'http://localhost');
      if (agentId && !url.searchParams.has('agent_id')) url.searchParams.set('agent_id', agentId);
      if (environment && !url.searchParams.has('environment')) url.searchParams.set('environment', environment);
      if (branchId && !url.searchParams.has('branch_id')) url.searchParams.set('branch_id', branchId);
      const response = await fetch(url.toString(), { method: 'GET' });
      const body = await response.text();
      if (!response.ok) throw new Error(`Signed URL endpoint failed: ${response.status} ${body.slice(0, 160)}`);
      try {
        const json = JSON.parse(body);
        if (json?.signed_url) return String(json.signed_url);
        if (json?.signedUrl) return String(json.signedUrl);
      } catch (_) {
        // Plain text signed URL is also supported.
      }
      if (/^wss:\/\//i.test(body.trim())) return body.trim();
      throw new Error('Signed URL endpoint did not return signed_url or a wss:// URL.');
    }

    if (!agentId) {
      throw new Error('Set EXPO_PUBLIC_ELEVENLABS_AGENT_ID or EXPO_PUBLIC_ELEVENLABS_AGENT_SIGNED_URL_ENDPOINT to use ElevenLabs Agent live mode.');
    }
    const url = new URL(DEFAULT_WS_BASE);
    url.searchParams.set('agent_id', agentId);
    if (environment) url.searchParams.set('environment', environment);
    if (branchId) url.searchParams.set('branch_id', branchId);
    return url.toString();
  }

  private sendInitiationData() {
    const payload: Record<string, unknown> = {
      type: 'conversation_initiation_client_data',
      dynamic_variables: {
        device: 'aga_voice_appliance',
        display_mode: AGA_CONFIG.display.mode,
        wake_engine: AGA_CONFIG.wake.engine,
      },
    };

    if (AGA_CONFIG.elevenLabsAgent.allowPromptOverride) {
      payload.conversation_config_override = {
        agent: {
          prompt: { prompt: agentInstructions(this.prefs) },
          ...(AGA_CONFIG.elevenLabsAgent.firstMessage ? { first_message: AGA_CONFIG.elevenLabsAgent.firstMessage } : {}),
          ...(AGA_CONFIG.elevenLabsAgent.language ? { language: AGA_CONFIG.elevenLabsAgent.language } : {}),
        },
        ...(AGA_CONFIG.tts.elevenLabsVoiceId ? { tts: { voice_id: AGA_CONFIG.tts.elevenLabsVoiceId } } : {}),
      };
    }

    this.sendOrQueue(payload);
  }

  private sendOrQueue(message: QueuedMessage) {
    if (isSocketOpen(this.socket)) {
      this.socket!.send(JSON.stringify(message));
      return;
    }
    this.queue.push(message);
  }

  private flushQueue() {
    const pending = this.queue.splice(0);
    for (const message of pending) this.sendOrQueue(message);
  }

  private handleSocketMessage(raw: unknown) {
    let event: any;
    try {
      event = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(String(raw));
    } catch {
      this.publish({ error: `Unparseable ElevenLabs Agent message: ${String(raw).slice(0, 120)}` });
      return;
    }

    const type = String(event?.type || '');
    if (type === 'ping') {
      const id = event?.ping_event?.event_id ?? event?.event_id;
      this.sendOrQueue({ type: 'pong', event_id: id });
      return;
    }

    if (type === 'conversation_initiation_metadata') {
      const meta = event?.conversation_initiation_metadata_event || {};
      this.publish({
        speechStatus: 'ElevenLabs Agent ready',
        voiceCapability: { ...(this.snapshot as any).voiceCapability, elevenLabsAgent: meta },
      } as any);
      return;
    }

    if (type === 'vad_score') {
      const score = Number(event?.vad_score_event?.vad_score || 0);
      if (Number.isFinite(score)) this.publish({ audioLevel: score });
      return;
    }

    if (type === 'user_transcript') {
      const text = cleanText(event?.user_transcription_event?.user_transcript);
      if (text) this.publish({ interim: text, mode: 'listening', speechStatus: `heard: ${text.slice(0, 60)}` });
      return;
    }

    if (type === 'agent_response' || type === 'agent_response_correction' || type === 'agent_chat_response_part') {
      const id = String(event?.agent_response_event?.event_id ?? event?.event_id ?? `${type}:${Date.now()}`);
      const text = cleanText(
        event?.agent_response_event?.agent_response
        ?? event?.agent_response_correction_event?.corrected_agent_response
        ?? event?.agent_response_correction_event?.agent_response
        ?? event?.agent_chat_response_part_event?.text
        ?? event?.text,
      );
      if (text && !this.seenEventIds.has(id)) {
        this.seenEventIds.add(id);
        this.agentTextBuffer = cleanText(`${this.agentTextBuffer} ${text}`);
        this.publish({ mode: 'speaking', interim: '', speechStatus: text.slice(0, 80) });
      }
      return;
    }

    if (type === 'audio') {
      const audio = String(event?.audio_event?.audio_base_64 || '');
      if (audio) this.enqueuePcmAudio(audio).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.publish({ error: message, speechStatus: 'ElevenLabs Agent audio playback unavailable' });
      });
      return;
    }

    if (type === 'agent_response_complete') {
      void this.finishAgentTurn();
      return;
    }

    if (type === 'interruption') {
      this.agentTextBuffer = '';
      this.nextPlaybackTime = 0;
      this.publish({ mode: 'listening', speechStatus: 'agent interrupted' });
      return;
    }

    if (type === 'client_tool_call') {
      const call = event?.client_tool_call || {};
      this.sendOrQueue({
        type: 'client_tool_result',
        tool_call_id: call.tool_call_id,
        result: 'AGA client tools are owned by the local capability router. Configure this ElevenLabs Agent to use server tools or ask AGA to handle device actions before live mode.',
        is_error: true,
      });
      return;
    }

    if (type === 'client_error' || type === 'guardrail_triggered') {
      this.publish({ mode: 'recovering', speechStatus: `ElevenLabs Agent ${type}`, error: JSON.stringify(event).slice(0, 500) });
    }
  }

  private async finishAgentTurn() {
    const text = cleanText(this.agentTextBuffer);
    this.agentTextBuffer = '';
    if (text) {
      await addMessage('assistant', text).catch(() => undefined);
      await this.refresh();
    }
    this.publish({ mode: 'listening', interim: '', speechStatus: 'ElevenLabs Agent listening' });
    this.options.onTurnDone?.();
  }

  private async enqueuePcmAudio(base64: string) {
    const root = getRoot();
    const AudioContextCtor = root.AudioContext || root.webkitAudioContext;
    if (!AudioContextCtor) return;
    const sampleRate = AGA_CONFIG.elevenLabsAgent.outputSampleRate || 16000;
    const context: AudioContext = this.outputAudioContext || new AudioContextCtor();
    this.outputAudioContext = context;
    if (context.state === 'suspended') await context.resume();
    const bytes = bytesFromBase64(base64);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const samples = Math.floor(bytes.byteLength / 2);
    const buffer = context.createBuffer(1, samples, sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples; i += 1) channel[i] = view.getInt16(i * 2, true) / 0x8000;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime + 0.02, this.nextPlaybackTime || 0);
    source.start(startAt);
    this.nextPlaybackTime = startAt + buffer.duration;
    this.publish({ mode: 'speaking', speechStatus: 'ElevenLabs Agent speaking' });
  }

  private async startMicrophoneBridge() {
    const root = getRoot();
    const AudioContextCtor = root.AudioContext || root.webkitAudioContext;
    const getUserMedia = root.navigator?.mediaDevices?.getUserMedia?.bind(root.navigator.mediaDevices);
    if (!AudioContextCtor || !getUserMedia) {
      throw new Error('Web Audio microphone bridge is unavailable. Use the ElevenLabs React Native SDK for full duplex native builds.');
    }
    const stream = await getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });
    const context: AudioContext = new AudioContextCtor();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(2048, 1, 1);
    processor.onaudioprocess = (event) => {
      if (!isSocketOpen(this.socket)) return;
      const input = event.inputBuffer.getChannelData(0);
      const sampleRate = context.sampleRate || 48000;
      const audio = pcm16Base64FromFloat32(input, sampleRate, AGA_CONFIG.elevenLabsAgent.inputSampleRate || 16000);
      this.socket!.send(JSON.stringify({ user_audio_chunk: audio }));
    };
    source.connect(processor);
    processor.connect(context.destination);
    this.mediaStream = stream;
    this.inputAudioContext = context;
    this.processor = processor;
    this.publish({ speechStatus: 'ElevenLabs Agent mic bridge active' });
  }

  private stopMicrophoneBridge() {
    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
    }
    this.processor = null;
    if (this.inputAudioContext) void this.inputAudioContext.close().catch(() => undefined);
    this.inputAudioContext = null;
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) track.stop();
    }
    this.mediaStream = null;
  }
}
