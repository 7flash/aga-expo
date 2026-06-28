import { AGA_CONFIG } from '../../config/agaConfig';
import type { ShortUtteranceAudio } from '../shortUtteranceRecorder';
import type { BrowserApplianceEvent, BrowserApplianceListener, BrowserLiveAgentLayer, BrowserSttLayer, BrowserTtsLayer, BrowserWakeLayer } from './types';
import { BrowserToolRouter } from './browserToolRouter';
import { ElevenLabsVoiceLayer, BrowserSpeechSynthesisFallbackLayer } from './elevenLabsVoiceLayer';
import { ElevenLabsLiveAgentLayer, NoopLiveAgentLayer } from './liveAgentLayer';
import { OpenAiSttLayer } from './openAiSttLayer';
import { SherpaWasmWakeLayer } from './sherpaWasmWakeLayer';
import { VolumeThresholdWakeLayer } from './volumeThresholdWakeLayer';
import { blockCapture, shouldBlockUserCapture } from '../speakListenGate';

function env(name: string, fallback = '') {
  return String(process.env?.[name] ?? fallback);
}

function clean(text: string) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

export type BrowserVoiceApplianceOptions = {
  wake?: BrowserWakeLayer;
  stt?: BrowserSttLayer;
  tts?: BrowserTtsLayer;
  live?: BrowserLiveAgentLayer;
  emit?: BrowserApplianceListener;
};

export class BrowserVoiceAppliance {
  private wake: BrowserWakeLayer;
  private stt: BrowserSttLayer;
  private tts: BrowserTtsLayer;
  private live: BrowserLiveAgentLayer;
  private router: BrowserToolRouter;
  private listeners = new Set<BrowserApplianceListener>();
  private processing = false;
  private started = false;

  constructor(options: BrowserVoiceApplianceOptions = {}) {
    this.wake = options.wake || createWakeLayerFromEnv();
    this.stt = options.stt || new OpenAiSttLayer();
    this.tts = options.tts || createTtsLayerFromEnv();
    this.live = options.live || createLiveLayerFromEnv();
    this.router = new BrowserToolRouter((event) => this.emit(event));
    if (options.emit) this.listeners.add(options.emit);
  }

  subscribe(listener: BrowserApplianceListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.emit({ type: 'status', mode: 'wake-listening', message: `Browser appliance starting. wake=${this.wake.name} stt=${this.stt.name} tts=${this.tts.name} live=${this.live.name}` });
    await this.wake.start((event) => this.handleWakeEvent(event));
    this.installWindowHooks();
  }

  async stop() {
    this.started = false;
    await this.live.stop();
    await this.tts.stop();
    await this.wake.stop();
    this.emit({ type: 'status', mode: 'idle', message: 'Browser appliance stopped.' });
  }

  async submitText(text: string) {
    await this.routeTranscript(clean(text), { manual: true });
  }

  getDiagnostics() {
    return {
      started: this.started,
      processing: this.processing,
      wake: this.wake.getDiagnostics?.(),
      stt: this.stt.name,
      tts: this.tts.name,
      live: this.live.name,
      liveActive: this.live.isActive(),
    };
  }

  private emit(event: BrowserApplianceEvent) {
    for (const listener of this.listeners) listener(event);
  }

  private handleWakeEvent(event: BrowserApplianceEvent) {
    if ((event.type === 'wake' || event.type === 'utterance') && shouldBlockUserCapture()) {
      this.emit({ type: 'status', mode: 'wake-listening', message: 'Ignored mic input because AGA is speaking.' });
      return;
    }
    this.emit(event);
    if (event.type === 'wake') {
      this.emit({ type: 'status', mode: 'awake', message: 'Wake detected.' });
    }
    if (event.type === 'utterance') {
      void this.handleAudio(event.audio).catch((error) => this.handleError(error));
    }
  }

  private async handleAudio(audio: ShortUtteranceAudio) {
    if (this.processing) return;
    this.processing = true;
    try {
      this.wake.mute?.(2500);
      blockCapture(12000, 'post_wake_processing');
      this.emit({ type: 'status', mode: 'transcribing', message: 'Your turn ended. Transcribing with OpenAI STT.' });
      const text = clean(await this.stt.transcribe(audio));
      if (!text) {
        this.emit({ type: 'status', mode: 'wake-listening', message: 'No speech recognized.' });
        return;
      }
      this.emit({ type: 'transcript', text });
      await this.routeTranscript(text, { audio });
    } finally {
      this.processing = false;
    }
  }

  private async routeTranscript(text: string, raw?: unknown) {
    const local = await this.router.runLocalControl(text);
    if (local.handled) {
      this.emit({ type: 'route', route: 'local-control', reason: 'local stop/pause/resume command' });
      await this.tts.stop();
      await this.live.stop();
      if (local.shouldSpeak && local.text) await this.speak(local.text, 'neutral');
      return;
    }

    const decision = this.router.classify(text);
    if (decision.path === 'live_session') {
      this.emit({ type: 'route', route: 'live-agent', reason: decision.reason });
      this.emit({ type: 'status', mode: 'live-session', message: `Delegating to ${this.live.name}.` });
      await this.live.startWithText(text);
      return;
    }

    if (decision.path === 'deterministic_guided') {
      this.emit({ type: 'route', route: 'deterministic-session', reason: decision.reason });
      // Keep browser lab simple: let GPT tools choose/start the guided session so the same tools are tested.
    } else {
      this.emit({ type: 'route', route: 'short-tools', reason: decision.reason });
    }

    this.emit({ type: 'status', mode: 'routing', message: 'Routing with GPT tools.' });
    const result = await this.router.runShortToolTurn(text);
    if (result.shouldSpeak && result.text) await this.speak(result.text, 'warm');
    this.emit({ type: 'assistant', text: result.text || '', raw });
  }

  private async speak(text: string, emotion: string) {
    this.wake.mute?.(Math.max(2500, text.length * 90));
    blockCapture(Math.max(2500, text.length * 90), 'assistant_speaking');
    this.emit({ type: 'status', mode: 'speaking', message: 'AGA is speaking. Normal wake/capture is paused.' });
    await this.tts.speak(text, { emotion });
    this.emit({ type: 'status', mode: 'wake-listening', message: 'Back to wake listening. Your turn.' });
  }

  private async handleError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || 'Unknown browser appliance error');
    this.emit({ type: 'error', message, raw: error });
    this.emit({ type: 'status', mode: 'error', message });
  }

  private installWindowHooks() {
    if (typeof window === 'undefined') return;
    const w = window as any;
    w.__AGA_BROWSER_APPLIANCE = this;
    w.__AGA_SUBMIT_TEXT = (text: string) => this.submitText(text);
    w.__AGA_STOP = () => this.stop();
  }
}

export function createWakeLayerFromEnv(): BrowserWakeLayer {
  const engine = env('EXPO_PUBLIC_AGA_BROWSER_WAKE_ENGINE', env('EXPO_PUBLIC_AGA_KEYWORD_ENGINE', 'volume_threshold')).toLowerCase();
  if (engine === 'sherpa' || engine === 'sherpa_wasm' || engine === 'sherpa-wasm') return new SherpaWasmWakeLayer();
  return new VolumeThresholdWakeLayer();
}

export function createTtsLayerFromEnv(): BrowserTtsLayer {
  const provider = env('EXPO_PUBLIC_AGA_SHORT_TTS_PROVIDER', AGA_CONFIG.tts.provider || 'elevenlabs').toLowerCase();
  if (provider === 'browser' || provider === 'speech_synthesis') return new BrowserSpeechSynthesisFallbackLayer();
  return new ElevenLabsVoiceLayer();
}

export function createLiveLayerFromEnv(): BrowserLiveAgentLayer {
  const engine = env('EXPO_PUBLIC_AGA_ENGINE', AGA_CONFIG.brain.liveEngine || 'elevenlabs_agent').toLowerCase();
  if (engine === 'elevenlabs_agent' || engine === 'elevenlabs-agent') return new ElevenLabsLiveAgentLayer();
  return new NoopLiveAgentLayer();
}

let singleton: BrowserVoiceAppliance | null = null;

export function getBrowserVoiceAppliance() {
  if (!singleton) singleton = new BrowserVoiceAppliance();
  return singleton;
}

export async function startDefaultBrowserVoiceAppliance() {
  const enabled = env('EXPO_PUBLIC_AGA_BROWSER_APPLIANCE', '1') !== '0';
  if (!enabled || typeof window === 'undefined') return null;
  const appliance = getBrowserVoiceAppliance();
  await appliance.start();
  return appliance;
}
