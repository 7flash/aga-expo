import type { AgaMode } from '../aga/turn';
import type { VoiceTransport } from '../voice/VoiceTransport';
import type { RealtimeSnapshot } from '../realtime/RealtimeSession';
import type { YouTubeResult } from '../media/youtube';
import type { AmbientResult } from '../media/ambient';
import {
  addMessage,
  initializeLocalStore,
  listMessages,
  listPendingReminders,
  loadPreferences,
  logEvent,
  type Preferences,
  type Reminder,
} from '../db/localStore';
import { configureNotificationHandler } from '../notifications/localNotifications';
import { measureAsync, measureMark } from '../observability/measure';
import { createCapabilityRunner } from '../aga/capabilityRunner';
import { localControlIntent } from '../aga/localControls';
import { findChoice, normalizeChoiceKey, type ChoiceMenu } from '../aga/choiceMenus';
import { buildTurnContextBlock } from '../aga/capabilityRegistry';
import { remoteConfigPromptBlock } from '../remote/config';
import { speakSoftly, stopSpeaking } from '../voice/speechOut';
import { agaEngineDiagnostics } from '../aga/engine';
import {
  addLiveAudioSeconds,
  canSpendGeminiInput,
  canSpendLiveAudio,
  geminiBudgetSnapshot,
  geminiBudgetSummary,
  readGeminiBudget,
  recordGeminiTurn,
  resetGeminiBudgetForToday,
} from './geminiCost';

function env(name: string) {
  return process.env?.[name] ?? '';
}

function geminiApiKey() {
  return env('EXPO_PUBLIC_GEMINI_API_KEY') || env('EXPO_PUBLIC_GOOGLE_API_KEY');
}

const LIVE_MODEL = env('EXPO_PUBLIC_GEMINI_LIVE_MODEL') || 'gemini-3.1-flash-live-preview';
const TEXT_MODEL = env('EXPO_PUBLIC_GEMINI_TEXT_MODEL') || 'gemini-2.5-flash-lite';

type GeminiTransport = 'text' | 'live' | 'duplex' | 'hybrid' | 'auto';

function numberEnv(name: string, fallback: number) {
  const raw = Number(env(name));
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

function envFlag(name: string, fallback: boolean) {
  const raw = env(name).trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function geminiTransport(): GeminiTransport {
  const explicit = (
    env('EXPO_PUBLIC_AGA_GEMINI_TRANSPORT') ||
    env('EXPO_PUBLIC_GEMINI_TRANSPORT') ||
    ''
  ).trim().toLowerCase();
  if (explicit === 'live' || explicit === 'duplex' || explicit === 'hybrid' || explicit === 'auto' || explicit === 'text') return explicit;
  if (envFlag('EXPO_PUBLIC_AGA_GEMINI_DUPLEX', false)) return 'duplex';
  if (envFlag('EXPO_PUBLIC_AGA_GEMINI_USE_LIVE', false)) return 'live';
  // Cost-safe default: REST text turns + local soft speech. Live stays opt-in.
  return 'text';
}

function geminiTextTimeoutMs() {
  return numberEnv('EXPO_PUBLIC_AGA_GEMINI_TEXT_TIMEOUT_MS', 12000);
}

type ActiveMedia =
  | (YouTubeResult & { type: 'youtube'; state: 'loading' | 'playing' | 'paused' | 'stopped' })
  | AmbientResult
  | null;

type Listener = (snapshot: RealtimeSnapshot) => void;

type GeminiLiveSessionOptions = {
  onTurnDone?: () => void;
};

function extractGeminiText(message: any) {
  const texts: string[] = [];
  const parts = message?.serverContent?.modelTurn?.parts ?? message?.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part?.text) texts.push(String(part.text));
  }
  const output = message?.serverContent?.outputTranscription?.text;
  if (output) texts.push(String(output));
  return texts.join('');
}

function isWakeOnlyPrompt(text: string) {
  const clean = String(text || '').trim().toLowerCase();
  return !clean ||
    clean === 'aga' ||
    clean === 'hey aga' ||
    clean === 'ok aga' ||
    clean === 'okay aga' ||
    clean.startsWith('the user said aga.');
}

function cleanAssistantText(text: string) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[(?:sound|music|pause|breath).*?]/gi, '')
    .trim();
}


function normalizeMediaText(text: string) {
  return String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function localMediaIntent(text: string, activeMedia: ActiveMedia): { tool: string; args: Record<string, unknown>; quiet?: boolean } | null {
  if (!activeMedia) return null;
  const clean = normalizeMediaText(text);
  if (!clean) return null;

  if (/\b(close|stop|dismiss|turn off|shut off)\b.*\b(video|youtube|music|song|player|ambient)?\b/.test(clean) || /^stop(?: the)? music$/.test(clean) || /\bstop music\b/.test(clean)) {
    return { tool: 'media_control', args: { command: 'stop' }, quiet: true };
  }
  if (/\b(pause|hold)\b.*\b(video|youtube|music|song|player|ambient)?\b/.test(clean) || /^pause$/.test(clean)) {
    return { tool: 'media_control', args: { command: 'pause' }, quiet: true };
  }
  if (/\b(resume|continue|unpause)\b.*\b(video|youtube|music|song|player|ambient)?\b/.test(clean) || /^resume$/.test(clean)) {
    return { tool: 'media_control', args: { command: 'resume' }, quiet: true };
  }
  if (/\b(mute|silent)\b/.test(clean)) return { tool: 'media_control', args: { command: 'mute' }, quiet: true };
  if (/\b(unmute)\b/.test(clean)) return { tool: 'media_control', args: { command: 'unmute' }, quiet: true };
  if (/\b(louder|volume up|turn it up|raise volume|more volume)\b/.test(clean)) return { tool: 'media_control', args: { command: 'volume_up' }, quiet: true };
  if (/\b(softer|quieter|volume down|turn it down|lower volume|less volume)\b/.test(clean)) return { tool: 'media_control', args: { command: 'volume_down' }, quiet: true };
  if (/\b(change|another|different|next|skip)\b.*\b(video|youtube|music|song|track)?\b/.test(clean)) {
    const base = (activeMedia as any)?.query || (activeMedia as any)?.title || 'calm ambient music';
    return { tool: 'play_youtube', args: { query: `different ${base}`, forceYouTube: (activeMedia as any)?.type === 'youtube' }, quiet: false };
  }
  return null;
}

function buildGeminiInstructions(prefs: Preferences | null) {
  return [
    'You are AGA, a soft, funny, friendly guardian angel voice companion.',
    'Keep replies brief unless the user asks for a guided session. For meditation/hypnosis, speak in short paced segments, not a giant monologue.',
    'Be warm, casual, and safe. Tiny gentle puns or charming self-corrections are welcome when the user is relaxed; never force jokes during distress.',
    'Answer in the language of the latest user utterance. If unclear, use English.',
    'The app handles media, settings, memories, reminders, and menus locally before your answer. Do not tell the user to click or tap.',
    'If the user asks to change voice/language/personality/listening, they should be handled locally; briefly acknowledge if the device reports it.',
    prefs?.personalityPrompt ? `Custom personality overlay: ${prefs.personalityPrompt}` : '',
    remoteConfigPromptBlock(),
    buildTurnContextBlock(prefs),
  ].filter(Boolean).join('
');
}


function wantsGeminiDuplexAudio() {
  const transport = geminiTransport();
  if (transport === 'duplex' || transport === 'hybrid') return true;
  if (transport === 'auto') return envFlag('EXPO_PUBLIC_AGA_GEMINI_AUTO_DUPLEX', true);
  return envFlag('EXPO_PUBLIC_AGA_GEMINI_LIVE_AUDIO', false);
}

function hasWebAudioDuplexSupport() {
  const root: any = globalThis as any;
  return !!(root.navigator?.mediaDevices?.getUserMedia && (root.AudioContext || root.webkitAudioContext));
}

function base64FromArrayBuffer(buffer: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function arrayBufferFromBase64(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function floatTo16BitPcm(float32: Float32Array) {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

function pcm16ToFloat32(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const out = new Float32Array(Math.floor(buffer.byteLength / 2));
  for (let i = 0; i < out.length; i += 1) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

function downsampleBuffer(input: Float32Array, inputRate: number, outputRate: number) {
  if (outputRate >= inputRate) return input;
  const ratio = inputRate / outputRate;
  const newLength = Math.round(input.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < input.length; i += 1) {
      accum += input[i];
      count += 1;
    }
    result[offsetResult] = count ? accum / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

const DUPLEX_STANDBY_PROMPT = '__AGA_DUPLEX_STANDBY__';

function isDuplexStandbyPrompt(text: string) {
  return String(text || '').trim() === DUPLEX_STANDBY_PROMPT;
}

function canUseLiveForTextFallbackRace() {
  const transport = geminiTransport();
  return transport === 'hybrid' || transport === 'auto' || envFlag('EXPO_PUBLIC_AGA_GEMINI_TEXT_RACE_FALLBACK', true);
}

export class GeminiLiveSession implements VoiceTransport {
  readonly name = 'gemini-live';
  private listeners = new Set<Listener>();
  private ws: any | null = null;
  private prefs: Preferences | null = null;
  private assistantBuffer = '';
  private pendingTexts: string[] = [];
  private turnInProgress = false;
  private billableInputChars = 0;
  private billableTransport: 'text' | 'live' | 'duplex' = 'text';
  private liveFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private duplexAudioActive = false;
  private micStream: any | null = null;
  private audioContext: any | null = null;
  private micSource: any | null = null;
  private micProcessor: any | null = null;
  private playbackTime = 0;
  private liveAudioStartedAt = 0;
  private liveAudioMeter = 0;
  private costTimer: ReturnType<typeof setInterval> | null = null;
  private options: GeminiLiveSessionOptions;

  private snapshot: RealtimeSnapshot = {
    ready: false,
    mode: 'sleeping',
    interim: '',
    messages: [],
    reminders: [],
    activeMedia: null as ActiveMedia,
    mediaCommand: null,
    audioLevel: 0,
    speechStatus: 'starting gemini live',
    error: null,
    activeChoiceMenu: null,
    sessionLabel: null,
    listeningMode: 'wake-word / turn mode',
    remoteConfigRevision: null,
    deviceLabel: null,
    nativeUpdateMessage: null,
  };

  constructor(options: GeminiLiveSessionOptions = {}) {
    this.options = options;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  private publish(patch: Partial<RealtimeSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch, geminiCost: geminiBudgetSnapshot(this.currentTransportLabel()) } as any;
    for (const listener of this.listeners) listener(this.snapshot);
  }

  private currentTransportLabel() {
    return this.duplexAudioActive ? 'duplex' : this.ws ? 'live' : 'text';
  }

  private setMode(mode: AgaMode) {
    this.publish({ mode });
  }

  async start() {
    return measureAsync('geminiLive.start', async () => {
      configureNotificationHandler();
      this.stopped = false;
      await initializeLocalStore();
      this.prefs = await loadPreferences();
      const engineInfo = agaEngineDiagnostics();
      this.publish({ voiceSummary: JSON.stringify(engineInfo), voiceCapability: engineInfo, speechStatus: `gemini engine:${engineInfo.source}` });
      measureMark('gemini.engine.selected', engineInfo);
      await logEvent('gemini.engine.selected', JSON.stringify(engineInfo)).catch(() => undefined);
      await this.refresh();
      const key = geminiApiKey();
      if (!key) throw new Error('Set EXPO_PUBLIC_GEMINI_API_KEY or EXPO_PUBLIC_GOOGLE_API_KEY for Gemini mode.');

      const transport = geminiTransport();
      if (transport === 'live' || transport === 'duplex' || transport === 'hybrid' || transport === 'auto') {
        await this.connectLive().catch(async (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error || 'Gemini Live unavailable');
          await logEvent('gemini.live.connect.fallback_text', message).catch(() => undefined);
          if (transport === 'live' && !envFlag('EXPO_PUBLIC_AGA_GEMINI_LIVE_FALLBACK_TEXT', true)) throw error;
          this.publish({ ready: true, speechStatus: `gemini text fallback:${TEXT_MODEL}`, error: null });
        });
      } else {
        await logEvent('gemini.transport', `text:${TEXT_MODEL}`).catch(() => undefined);
      }

      const status = this.duplexAudioActive ? `gemini duplex:${LIVE_MODEL}` : this.ws ? `gemini live:${LIVE_MODEL}` : `gemini text:${TEXT_MODEL}`;
      this.startCostTicker();
      this.publish({ ready: true, mode: 'listening', speechStatus: status, error: null, listeningMode: `wake-word / ${this.currentTransportLabel()} mode` });
    });
  }

  private async connectLive() {
    const key = geminiApiKey();
    if (!key) throw new Error('Missing Gemini API key.');
    const root: any = globalThis as any;
    if (!root.WebSocket) throw new Error('WebSocket is not available in this runtime.');
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(key)}`;
    await new Promise<void>((resolve, reject) => {
      const ws = new root.WebSocket(url);
      let opened = false;
      const timer = setTimeout(() => reject(new Error('Gemini Live WebSocket timed out.')), numberEnv('EXPO_PUBLIC_AGA_GEMINI_LIVE_CONNECT_TIMEOUT_MS', 8000));
      ws.onopen = () => {
        opened = true;
        clearTimeout(timer);
        this.ws = ws;
        ws.send(JSON.stringify({
          setup: {
            model: `models/${LIVE_MODEL}`,
            responseModalities: wantsGeminiDuplexAudio() && hasWebAudioDuplexSupport() && canSpendLiveAudio().ok ? ['AUDIO'] : ['TEXT'],
            systemInstruction: { parts: [{ text: buildGeminiInstructions(this.prefs) }] },
          },
        }));
        measureMark('gemini.live.open', { model: LIVE_MODEL, duplexRequested: wantsGeminiDuplexAudio(), webAudio: hasWebAudioDuplexSupport() });
        if (wantsGeminiDuplexAudio() && hasWebAudioDuplexSupport() && canSpendLiveAudio().ok) {
          void this.startDuplexAudio(ws).catch((error) => {
            const message = error instanceof Error ? error.message : String(error || 'duplex audio failed');
            measureMark('gemini.duplex.failed', { message });
            this.publish({ speechStatus: `gemini live text fallback: ${message}` });
          });
        }
        resolve();
      };
      ws.onmessage = (event: MessageEvent) => void this.onGeminiMessage(event.data);
      ws.onerror = () => {
        if (!opened) reject(new Error('Gemini Live WebSocket error.'));
        else this.publish({ error: 'Gemini Live WebSocket error.' });
      };
      ws.onclose = () => {
        if (!this.stopped) {
          this.duplexAudioActive = false;
          this.publish({ speechStatus: 'gemini live closed; text fallback ready', listeningMode: 'wake-word / text fallback' });
        }
        if (this.ws === ws) this.ws = null;
      };
    });
  }

  private async callTextFallback(text: string) {
    const key = geminiApiKey();
    if (!key) throw new Error('Missing Gemini API key.');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(TEXT_MODEL)}:generateContent?key=${encodeURIComponent(key)}`;
    const root: any = globalThis as any;
    const controller = typeof root.AbortController === 'function' ? new root.AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), geminiTextTimeoutMs())
      : null;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller?.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: buildGeminiInstructions(this.prefs) }] },
          contents: [
            { role: 'user', parts: [{ text }] },
          ],
          generationConfig: {
            maxOutputTokens: numberEnv('EXPO_PUBLIC_GEMINI_MAX_OUTPUT_TOKENS', 220),
            temperature: numberEnv('EXPO_PUBLIC_GEMINI_TEMPERATURE', 0.65),
          },
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`Gemini text failed: ${JSON.stringify(data).slice(0, 220)}`);
      const answer = cleanAssistantText(extractGeminiText(data));
      return answer || 'I heard you, but my tiny cloud halo blinked and came back empty. Can you say that again?';
    } catch (error: any) {
      if (error?.name === 'AbortError') throw new Error(`Gemini text timed out after ${geminiTextTimeoutMs()}ms.`);
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async onGeminiMessage(raw: any) {
    let event: any;
    try { event = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(String(raw)); } catch { return; }
    measureMark('gemini.live.event', { keys: Object.keys(event || {}).join(',').slice(0, 60) });
    const audioPart = this.extractAudioPart(event);
    if (audioPart) await this.playPcmAudio(audioPart.data, audioPart.rate);
    const text = extractGeminiText(event);
    if (text) {
      this.assistantBuffer += text;
      this.publish({ interim: this.assistantBuffer });
      this.setMode('speaking');
    }
    const complete = !!(event?.serverContent?.turnComplete || event?.serverContent?.generationComplete || event?.usageMetadata);
    if (complete && this.turnInProgress) {
      await this.finishAssistantTurn(this.assistantBuffer || '');
    }
  }

  private canSpendGeminiTurn(text: string) {
    return canSpendGeminiInput(text);
  }

  private recordGeminiTurn(outputText: string) {
    if (!this.billableInputChars) return;
    const next = recordGeminiTurn(this.billableInputChars, outputText, this.billableTransport);
    measureMark('gemini.budget.record', next);
    this.billableInputChars = 0;
  }

  private geminiBudgetStatus() {
    return geminiBudgetSummary(this.currentTransportLabel());
  }

  private async finishAssistantTurn(text: string) {
    if (this.liveFallbackTimer) clearTimeout(this.liveFallbackTimer);
    this.liveFallbackTimer = null;
    const clean = cleanAssistantText(text);
    this.turnInProgress = false;
    this.assistantBuffer = '';
    this.recordGeminiTurn(clean);
    if (clean) {
      await addMessage('assistant', clean);
      await this.refresh();
      this.publish({ interim: clean, speechStatus: 'gemini speaking' });
      if (!this.duplexAudioActive || envFlag('EXPO_PUBLIC_AGA_GEMINI_LOCAL_TTS', false)) {
        await speakSoftly(clean, { locale: this.prefs?.voiceLocale });
      }
    }
    this.publish({ interim: '', mode: this.snapshot.activeMedia ? 'media' : 'listening', speechStatus: 'gemini:turn_done' });
    if (!this.duplexAudioActive) setTimeout(() => this.options.onTurnDone?.(), numberEnv('EXPO_PUBLIC_AGA_GEMINI_REARM_DELAY_MS', 600));
  }

  private capabilityRunner() {
    return createCapabilityRunner({
      getPrefs: () => this.prefs,
      setPrefs: (prefs) => { this.prefs = prefs; },
      publish: (patch) => {
        const mediaState = patch.mediaState as ('playing' | 'paused' | 'stopped' | undefined);
        const normalized = { ...patch } as any;
        delete normalized.mediaState;
        if (mediaState && this.snapshot.activeMedia) normalized.activeMedia = { ...this.snapshot.activeMedia, state: mediaState };
        this.publish(normalized);
      },
      setMode: (mode) => this.setMode(mode),
      refresh: () => this.refresh(),
      updateRealtimeSession: () => undefined,
      applyRemoteConfig: async () => undefined,
      requestReconnect: () => undefined,
      getActiveChoiceMenu: () => this.snapshot.activeChoiceMenu,
      defaultVoice: 'soft',
    });
  }

  private async maybeHandleChoice(text: string) {
    const menu = this.snapshot.activeChoiceMenu;
    if (!menu) return false;
    const key = normalizeChoiceKey(text);
    if (!key) return false;
    const output = await this.capabilityRunner().chooseFromText(text);
    if (!output) return false;
    await this.sayLocal(output, 'choice');
    return true;
  }

  private async maybeHandleLocalControl(text: string) {
    const mediaIntent = localMediaIntent(text, this.snapshot.activeMedia as ActiveMedia);
    const intent = mediaIntent ?? localControlIntent(text);
    if (!intent) return false;
    if (intent.tool === 'gemini_cost_status') {
      await this.sayLocal(this.geminiBudgetStatus(), 'gemini_cost_status');
      return true;
    }
    if (/\b(reset|clear)\b.*\b(gemini|budget|cost)\b/i.test(text) || /\b(gemini|budget|cost)\b.*\b(reset|clear)\b/i.test(text)) {
      resetGeminiBudgetForToday();
      this.publish({ geminiCost: geminiBudgetSnapshot(this.currentTransportLabel()) } as any);
      await this.sayLocal('Gemini budget display reset for today.', 'gemini_budget_reset');
      return true;
    }
    let output = '';
    try { output = await this.capabilityRunner().run(intent.tool, intent.args ?? {}); }
    catch (error) { output = error instanceof Error ? error.message : 'That control failed.'; }
    await logEvent('gemini.local_control', `${intent.tool}: ${output.slice(0, 220)}`).catch(() => undefined);
    if ((intent as any).quiet || (intent.tool === 'media_control' && !envFlag('EXPO_PUBLIC_AGA_SPEAK_MEDIA_CONFIRMATIONS', false))) {
      const cleanOutput = output || 'Done.';
      await addMessage('assistant', cleanOutput);
      await this.refresh();
      this.publish({ interim: '', speechStatus: `local:${intent.tool}`, mode: this.snapshot.activeMedia ? 'media' : 'listening' });
      return true;
    }
    await this.sayLocal(output || 'Done.', intent.tool);
    return true;
  }

  private async sayLocal(text: string, reason: string) {
    const clean = cleanAssistantText(text);
    if (!clean) return;
    this.turnInProgress = false;
    await addMessage('assistant', clean);
    await this.refresh();
    this.publish({ interim: clean, speechStatus: `local:${reason}` });
    const shouldSpeakLocal = envFlag('EXPO_PUBLIC_AGA_GEMINI_LOCAL_TTS', false) || envFlag('EXPO_PUBLIC_AGA_LOCAL_TTS_FALLBACK', false);
    this.setMode(shouldSpeakLocal ? 'speaking' : (this.snapshot.activeMedia ? 'media' : 'listening'));
    if (shouldSpeakLocal) await speakSoftly(clean, { locale: this.prefs?.voiceLocale });
    this.publish({ interim: '', mode: this.snapshot.activeMedia ? 'media' : 'listening', speechStatus: 'gemini:turn_done' });
    if (!this.duplexAudioActive) setTimeout(() => this.options.onTurnDone?.(), numberEnv('EXPO_PUBLIC_AGA_GEMINI_REARM_DELAY_MS', 600));
  }

  async replay(text: string) {
    const clean = String(text ?? '').trim();
    if (!clean || this.stopped) return;
    if (isDuplexStandbyPrompt(clean)) {
      // Used when local native/browser STT is unavailable on the physical device.
      // Gemini Live audio becomes the listening layer; do not spend a REST text
      // turn or immediately rearm wake scout.
      this.publish({
        mode: this.duplexAudioActive ? 'listening' : 'awake',
        interim: '',
        speechStatus: this.duplexAudioActive ? 'Gemini duplex listening — say AGA or speak naturally' : 'Gemini standby ready; duplex audio unavailable, text fallback waiting',
        listeningMode: this.duplexAudioActive ? 'Gemini Live duplex wake fallback' : 'Gemini text fallback',
      });
      return;
    }
    if (this.turnInProgress) {
      this.publish({ speechStatus: 'gemini is finishing the current turn; say AGA again after the chime', interim: clean.slice(0, 120) });
      await logEvent('gemini.turn.dropped_while_busy', clean.slice(0, 220)).catch(() => undefined);
      return;
    }

    // Wake-only should not spend a paid model turn. The app can acknowledge
    // locally, rearm the wake scout, and wait for the real command.
    if (isWakeOnlyPrompt(clean)) {
      await this.sayLocal("I'm here — soft halo online. What do you need? You can just say the request now.", 'wake_only');
      return;
    }

    await addMessage('user', clean);
    await this.refresh();
    if (await this.maybeHandleChoice(clean)) return;
    if (await this.maybeHandleLocalControl(clean)) return;

    const budget = this.canSpendGeminiTurn(clean);
    if (!budget.ok) {
      await logEvent('gemini.budget.blocked', budget.reason).catch(() => undefined);
      await this.sayLocal(`${budget.reason} Say AGA open menu, play music, or change voice and I can still do that locally.`, 'gemini_budget');
      return;
    }

    this.setMode('thinking');
    this.publish({ speechStatus: this.ws ? `asking gemini live:${LIVE_MODEL}` : `asking gemini:${TEXT_MODEL}`, error: null });
    this.turnInProgress = true;
    this.assistantBuffer = '';
    this.billableInputChars = clean.length;
    this.billableTransport = this.duplexAudioActive ? 'duplex' : this.ws?.readyState === 1 ? 'live' : 'text';

    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: clean }] }], turnComplete: true } }));
      // Some Live text turns do not emit an obvious final event in all clients.
      // If nothing completes quickly, fall back to REST so the user gets a reply.
      this.liveFallbackTimer = canUseLiveForTextFallbackRace() ? setTimeout(() => {
        if (!this.turnInProgress) return;
        if (this.assistantBuffer) {
          void this.finishAssistantTurn(this.assistantBuffer);
          return;
        }
        this.billableTransport = 'text';
        void this.callTextFallback(clean)
          .then((answer) => this.finishAssistantTurn(answer))
          .catch((error) => this.failTurn(error));
      }, numberEnv('EXPO_PUBLIC_AGA_GEMINI_LIVE_TEXT_TIMEOUT_MS', 6500)) : null;
      return;
    }

    try {
      const answer = await this.callTextFallback(clean);
      await this.finishAssistantTurn(answer);
    } catch (error) {
      await this.failTurn(error);
    }
  }


  private extractAudioPart(event: any): { data: string; rate: number } | null {
    const parts = event?.serverContent?.modelTurn?.parts ?? [];
    for (const part of parts) {
      const inline = part?.inlineData ?? part?.inline_data;
      const mime = String(inline?.mimeType ?? inline?.mime_type ?? '');
      const data = inline?.data;
      if (data && /audio/pcm/i.test(mime)) {
        const match = mime.match(/rate=(d+)/i);
        return { data: String(data), rate: match ? Number(match[1]) || 24000 : 24000 };
      }
    }
    return null;
  }

  private async ensureAudioContext() {
    const root: any = globalThis as any;
    if (!this.audioContext) {
      const Ctx = root.AudioContext || root.webkitAudioContext;
      if (!Ctx) throw new Error('WebAudio is not available.');
      this.audioContext = new Ctx();
    }
    if (this.audioContext.state === 'suspended') await this.audioContext.resume();
    return this.audioContext;
  }

  private async startDuplexAudio(ws: any) {
    const liveOk = canSpendLiveAudio();
    if (!liveOk.ok) throw new Error(liveOk.reason);
    const root: any = globalThis as any;
    const ctx = await this.ensureAudioContext();
    const stream = await root.navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false,
    });
    this.micStream = stream;
    this.micSource = ctx.createMediaStreamSource(stream);
    const bufferSize = numberEnv('EXPO_PUBLIC_AGA_GEMINI_AUDIO_BUFFER_SIZE', 4096);
    this.micProcessor = ctx.createScriptProcessor(bufferSize, 1, 1);
    this.micProcessor.onaudioprocess = (event: any) => {
      if (this.stopped || this.ws !== ws || ws.readyState !== 1) return;
      const input = event.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < input.length; i += 32) sum += Math.abs(input[i]);
      this.liveAudioMeter = Math.min(1, sum / Math.max(1, input.length / 32) * 9);
      const downsampled = downsampleBuffer(input, ctx.sampleRate, 16000);
      const pcm = floatTo16BitPcm(downsampled);
      const data = base64FromArrayBuffer(pcm);
      try {
        ws.send(JSON.stringify({ realtimeInput: { mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data }] } }));
      } catch { /* socket closing */ }
    };
    this.micSource.connect(this.micProcessor);
    // ScriptProcessor must be connected to run, but do not route microphone
    // audio to speakers. Use a zero-gain sink to avoid echo/feedback.
    const sink = typeof ctx.createGain === 'function' ? ctx.createGain() : null;
    if (sink) {
      sink.gain.value = 0;
      this.micProcessor.connect(sink);
      sink.connect(ctx.destination);
    } else {
      this.micProcessor.connect(ctx.destination);
    }
    this.duplexAudioActive = true;
    this.liveAudioStartedAt = Date.now();
    this.publish({ speechStatus: `gemini duplex live:${LIVE_MODEL}`, audioLevel: 0.2, listeningMode: 'Gemini Live duplex' });
    measureMark('gemini.duplex.started', { sampleRate: ctx.sampleRate, bufferSize });
  }

  private async playPcmAudio(data: string, rate = 24000) {
    const ctx = await this.ensureAudioContext();
    const pcm = pcm16ToFloat32(arrayBufferFromBase64(data));
    const audioBuffer = ctx.createBuffer(1, pcm.length, rate);
    audioBuffer.copyToChannel(pcm, 0);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.02, this.playbackTime || now);
    source.start(startAt);
    this.playbackTime = startAt + audioBuffer.duration;
    this.setMode('speaking');
    this.publish({ audioLevel: 0.84, speechStatus: 'gemini duplex speaking' });
    const ms = Math.max(120, audioBuffer.duration * 1000);
    setTimeout(() => {
      if (this.snapshot.mode === 'speaking') this.publish({ audioLevel: this.liveAudioMeter || 0.25, mode: this.snapshot.activeMedia ? 'media' : 'listening' });
    }, ms);
  }

  private stopDuplexAudio() {
    if (this.liveAudioStartedAt) {
      const seconds = Math.max(0, (Date.now() - this.liveAudioStartedAt) / 1000);
      const next = addLiveAudioSeconds(seconds);
      measureMark('gemini.duplex.seconds', next);
    }
    this.liveAudioStartedAt = 0;
    this.duplexAudioActive = false;
    try { this.micProcessor?.disconnect(); } catch { /* ignore */ }
    try { this.micSource?.disconnect(); } catch { /* ignore */ }
    try { this.micStream?.getTracks?.().forEach((track) => track.stop()); } catch { /* ignore */ }
    this.micProcessor = null;
    this.micSource = null;
    this.micStream = null;
    this.playbackTime = 0;
  }

  private startCostTicker() {
    if (this.costTimer) clearInterval(this.costTimer);
    this.costTimer = setInterval(() => {
      if (this.duplexAudioActive && this.liveAudioStartedAt) {
        const budget = readGeminiBudget();
        const elapsed = Math.max(0, (Date.now() - this.liveAudioStartedAt) / 1000);
        const projected = budget.liveAudioSeconds + elapsed;
        this.publish({ geminiCost: { ...geminiBudgetSnapshot(this.currentTransportLabel()), liveAudioSeconds: projected } } as any);
        const liveLimit = geminiBudgetSnapshot(this.currentTransportLabel()).maxLiveAudioSeconds;
        if (liveLimit > 0 && projected >= liveLimit) {
          this.publish({ speechStatus: 'Gemini live-audio budget reached; switching to text fallback', listeningMode: 'Gemini text fallback' });
          this.stopDuplexAudio();
          try { this.ws?.close?.(); } catch { /* ignore */ }
          this.ws = null;
        }
      } else {
        this.publish({ geminiCost: geminiBudgetSnapshot(this.currentTransportLabel()) } as any);
      }
    }, 1200);
  }

  private async failTurn(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || 'Gemini failed.');
    if (this.liveFallbackTimer) clearTimeout(this.liveFallbackTimer);
    this.liveFallbackTimer = null;
    this.turnInProgress = false;
    this.billableInputChars = 0;
    this.publish({ mode: 'recovering', error: message, speechStatus: 'gemini failed' });
    await logEvent('gemini.error', message).catch(() => undefined);
    await this.sayLocal('Gemini had a tiny cloud hiccup. Say AGA and try again.', 'gemini_error');
  }

  private async refresh() {
    const [messages, reminders] = await Promise.all([listMessages(16), listPendingReminders(6)]);
    this.publish({ messages, reminders });
  }

  rearmMic() {
    this.publish({ speechStatus: 'gemini turn mode: say AGA again for the next command' });
  }

  closeMedia() {
    this.publish({ activeMedia: null, mediaCommand: 'stop' });
    this.setMode('listening');
  }

  onMediaEvent(raw: string) {
    let type = raw;
    try { type = JSON.parse(raw)?.type ?? raw; } catch { /* keep raw */ }
    const current = this.snapshot.activeMedia as any;
    if (!current) return;
    const text = String(type);
    if (text.includes('mount') || text.includes('load') || text.includes('ready') || text.includes('buffering')) return;
    const state = text.includes('paused') || text.includes('pause')
      ? 'paused'
      : text.includes('playing') || text.includes('resume')
        ? 'playing'
        : text.includes('ended') || text.includes('stop') || text.includes('error')
          ? 'stopped'
          : current.state;
    if (state === 'stopped') {
      this.publish({ activeMedia: null, mediaCommand: null });
      this.setMode('listening');
      return;
    }
    if (state !== current.state) this.publish({ activeMedia: { ...current, state }, mediaCommand: null });
  }

  async stop() {
    this.stopped = true;
    if (this.costTimer) clearInterval(this.costTimer);
    this.costTimer = null;
    this.stopDuplexAudio();
    await stopSpeaking();
    try { this.ws?.close?.(); } catch { /* ignore */ }
    this.ws = null;
    if (this.liveFallbackTimer) clearTimeout(this.liveFallbackTimer);
    this.liveFallbackTimer = null;
    this.turnInProgress = false;
    this.billableInputChars = 0;
  }
}