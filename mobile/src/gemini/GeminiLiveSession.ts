import type { AgaMode } from '../aga/turn';
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

function env(name: string) {
  return process.env?.[name] ?? '';
}

function geminiApiKey() {
  return env('EXPO_PUBLIC_GEMINI_API_KEY') || env('EXPO_PUBLIC_GOOGLE_API_KEY');
}

const LIVE_MODEL = env('EXPO_PUBLIC_GEMINI_LIVE_MODEL') || 'gemini-3.1-flash-live-preview';
const TEXT_MODEL = env('EXPO_PUBLIC_GEMINI_TEXT_MODEL') || 'gemini-2.5-flash-lite';

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

function cleanAssistantText(text: string) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\[(?:sound|music|pause|breath).*?\]/gi, '')
    .trim();
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
  ].filter(Boolean).join('\n');
}

export class GeminiLiveSession {
  private listeners = new Set<Listener>();
  private ws: WebSocket | null = null;
  private prefs: Preferences | null = null;
  private assistantBuffer = '';
  private pendingTexts: string[] = [];
  private turnInProgress = false;
  private stopped = false;
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
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
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
      await this.refresh();
      const key = geminiApiKey();
      if (!key) throw new Error('Set EXPO_PUBLIC_GEMINI_API_KEY or EXPO_PUBLIC_GOOGLE_API_KEY for Gemini mode.');
      await this.connectLive().catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error || 'Gemini Live unavailable');
        await logEvent('gemini.live.connect.fallback_text', message).catch(() => undefined);
        this.publish({ ready: true, speechStatus: `gemini text fallback:${TEXT_MODEL}`, error: null });
      });
      this.publish({ ready: true, mode: 'listening', speechStatus: this.ws ? `gemini live:${LIVE_MODEL}` : `gemini text:${TEXT_MODEL}`, error: null });
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
      const timer = setTimeout(() => reject(new Error('Gemini Live WebSocket timed out.')), 8000);
      ws.onopen = () => {
        opened = true;
        clearTimeout(timer);
        this.ws = ws;
        ws.send(JSON.stringify({
          setup: {
            model: `models/${LIVE_MODEL}`,
            // Start with TEXT output to avoid raw PCM playback complexity while
            // still using the Live session protocol. Full native audio can be
            // enabled later through a PCM player or server voice bridge.
            responseModalities: ['TEXT'],
            systemInstruction: { parts: [{ text: buildGeminiInstructions(this.prefs) }] },
          },
        }));
        measureMark('gemini.live.open', { model: LIVE_MODEL });
        resolve();
      };
      ws.onmessage = (event: MessageEvent) => void this.onGeminiMessage(event.data);
      ws.onerror = () => {
        if (!opened) reject(new Error('Gemini Live WebSocket error.'));
        else this.publish({ error: 'Gemini Live WebSocket error.' });
      };
      ws.onclose = () => {
        if (!this.stopped) this.publish({ speechStatus: 'gemini live closed; text fallback ready' });
        if (this.ws === ws) this.ws = null;
      };
    });
  }

  private async callTextFallback(text: string) {
    const key = geminiApiKey();
    if (!key) throw new Error('Missing Gemini API key.');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(TEXT_MODEL)}:generateContent?key=${encodeURIComponent(key)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildGeminiInstructions(this.prefs) }] },
        contents: [
          { role: 'user', parts: [{ text }] },
        ],
        generationConfig: {
          maxOutputTokens: Number(env('EXPO_PUBLIC_GEMINI_MAX_OUTPUT_TOKENS') || 240),
          temperature: Number(env('EXPO_PUBLIC_GEMINI_TEMPERATURE') || 0.7),
        },
      }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Gemini text failed: ${JSON.stringify(data).slice(0, 220)}`);
    return cleanAssistantText(extractGeminiText(data));
  }

  private async onGeminiMessage(raw: any) {
    let event: any;
    try { event = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(String(raw)); } catch { return; }
    measureMark('gemini.live.event', { keys: Object.keys(event || {}).join(',').slice(0, 60) });
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

  private async finishAssistantTurn(text: string) {
    const clean = cleanAssistantText(text);
    this.turnInProgress = false;
    this.assistantBuffer = '';
    if (clean) {
      await addMessage('assistant', clean);
      await this.refresh();
      this.publish({ interim: clean, speechStatus: 'gemini speaking' });
      await speakSoftly(clean, { locale: this.prefs?.voiceLocale });
    }
    this.publish({ interim: '', mode: this.snapshot.activeMedia ? 'media' : 'listening', speechStatus: 'gemini:turn_done' });
    setTimeout(() => this.options.onTurnDone?.(), Number(env('EXPO_PUBLIC_AGA_GEMINI_REARM_DELAY_MS') || 600));
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
    const intent = localControlIntent(text);
    if (!intent) return false;
    let output = '';
    try { output = await this.capabilityRunner().run(intent.tool, intent.args ?? {}); }
    catch (error) { output = error instanceof Error ? error.message : 'That control failed.'; }
    await logEvent('gemini.local_control', `${intent.tool}: ${output.slice(0, 220)}`).catch(() => undefined);
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
    this.setMode('speaking');
    await speakSoftly(clean, { locale: this.prefs?.voiceLocale });
    this.publish({ interim: '', mode: this.snapshot.activeMedia ? 'media' : 'listening', speechStatus: 'gemini:turn_done' });
    setTimeout(() => this.options.onTurnDone?.(), Number(env('EXPO_PUBLIC_AGA_GEMINI_REARM_DELAY_MS') || 600));
  }

  async replay(text: string) {
    const clean = String(text ?? '').trim();
    if (!clean || this.stopped) return;
    await addMessage('user', clean);
    await this.refresh();
    if (await this.maybeHandleChoice(clean)) return;
    if (await this.maybeHandleLocalControl(clean)) return;

    this.setMode('thinking');
    this.publish({ speechStatus: this.ws ? `asking gemini live:${LIVE_MODEL}` : `asking gemini:${TEXT_MODEL}`, error: null });
    this.turnInProgress = true;
    this.assistantBuffer = '';

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ realtimeInput: { text: clean } }));
      // Some Live text turns do not emit an obvious final event in all clients.
      // If nothing completes quickly, fall back to REST so the user gets a reply.
      setTimeout(() => {
        if (!this.turnInProgress) return;
        if (this.assistantBuffer) {
          void this.finishAssistantTurn(this.assistantBuffer);
          return;
        }
        void this.callTextFallback(clean)
          .then((answer) => this.finishAssistantTurn(answer))
          .catch((error) => this.failTurn(error));
      }, Number(env('EXPO_PUBLIC_AGA_GEMINI_LIVE_TEXT_TIMEOUT_MS') || 6500));
      return;
    }

    try {
      const answer = await this.callTextFallback(clean);
      await this.finishAssistantTurn(answer);
    } catch (error) {
      await this.failTurn(error);
    }
  }

  private async failTurn(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || 'Gemini failed.');
    this.turnInProgress = false;
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
    await stopSpeaking();
    try { this.ws?.close?.(); } catch { /* ignore */ }
    this.ws = null;
    this.turnInProgress = false;
  }
}
