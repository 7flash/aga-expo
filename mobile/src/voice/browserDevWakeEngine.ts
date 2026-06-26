import { Platform } from 'react-native';
import { detectWake, normalizeSpeech, removeWakePhrase } from '../aga/text';
import { measureMark } from '../observability/measure';

export type BrowserDevWakeEvent =
  | { type: 'wake'; text?: string }
  | { type: 'control'; command: 'stop' | 'pause' | 'resume' }
  | { type: 'transcript'; text: string; final: boolean };

export type BrowserDevWakeCallbacks = {
  onEvent: (event: BrowserDevWakeEvent) => void;
  onStatus?: (status: string) => void;
  onError?: (message: string) => void;
};

function env(name: string) {
  return process.env?.[name] ?? '';
}

function boolEnv(name: string, fallback: boolean) {
  const raw = String(env(name) || '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function numberEnv(name: string, fallback: number) {
  const value = Number(env(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getSpeechRecognitionCtor(): any | null {
  if (Platform.OS !== 'web') return null;
  const root: any = globalThis as any;
  return root.SpeechRecognition || root.webkitSpeechRecognition || null;
}

function controlFromText(text: string): 'stop' | 'pause' | 'resume' | null {
  if (/\b(stop|quiet|cancel|shush|hush)\b/i.test(text)) return 'stop';
  if (/\b(pause|hold)\b/i.test(text)) return 'pause';
  if (/\b(resume|continue|unpause)\b/i.test(text)) return 'resume';
  return null;
}

/**
 * Web/dev-only wake engine.
 *
 * The Android appliance path remains Porcupine keyword spotting. This fallback is
 * only for Expo web/Galaxy-browser preview where the native Porcupine module and
 * keyword .ppn assets cannot run. It keeps the screen useful during debugging by
 * showing interim words and routing final phrases through the same controller.
 */
export class BrowserDevWakeEngine {
  private callbacks: BrowserDevWakeCallbacks;
  private recognition: any | null = null;
  private running = false;
  private restarting = false;
  private armedUntil = 0;
  private wakePhrase: string;
  private finalCount = 0;
  private lastTranscript = '';
  private lastError: string | null = null;

  constructor(callbacks: BrowserDevWakeCallbacks, wakePhrase = env('EXPO_PUBLIC_AGA_WAKE_WORD') || 'aga') {
    this.callbacks = callbacks;
    this.wakePhrase = wakePhrase;
  }

  getDiagnostics() {
    return {
      provider: 'web-speech-dev',
      available: !!getSpeechRecognitionCtor(),
      running: this.running,
      finalCount: this.finalCount,
      lastTranscript: this.lastTranscript,
      lastError: this.lastError,
      wakePhrase: this.wakePhrase,
    };
  }

  async start() {
    if (this.running) return;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) throw new Error('Browser SpeechRecognition is not available. Use Chrome/Edge for web preview, or run Android with Porcupine.');
    this.running = true;
    this.callbacks.onStatus?.('web preview mic starting — Android build uses Porcupine');
    this.createRecognition(Ctor);
    this.safeStart();
  }

  async stop() {
    this.running = false;
    const rec = this.recognition;
    this.recognition = null;
    try { rec?.onresult && (rec.onresult = null); } catch { /* ignore */ }
    try { rec?.onend && (rec.onend = null); } catch { /* ignore */ }
    try { rec?.onerror && (rec.onerror = null); } catch { /* ignore */ }
    try { rec?.stop?.(); } catch { /* ignore */ }
    this.callbacks.onStatus?.('web preview mic stopped');
  }

  private createRecognition(Ctor: any) {
    const rec = new Ctor();
    rec.continuous = boolEnv('EXPO_PUBLIC_AGA_WEB_SPEECH_CONTINUOUS', true);
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = env('EXPO_PUBLIC_AGA_WEB_SPEECH_LANG') || 'en-US';
    rec.onresult = (event: any) => this.onResult(event);
    rec.onerror = (event: any) => {
      const code = String(event?.error || 'speech error');
      this.lastError = code;
      this.callbacks.onError?.(`web preview speech: ${code}`);
    };
    rec.onend = () => {
      if (!this.running || this.restarting) return;
      const delay = numberEnv('EXPO_PUBLIC_AGA_WEB_SPEECH_RESTART_MS', 350);
      this.callbacks.onStatus?.('web preview mic restarting');
      setTimeout(() => this.safeStart(), delay);
    };
    this.recognition = rec;
  }

  private safeStart() {
    if (!this.running || !this.recognition) return;
    try {
      this.restarting = true;
      this.recognition.start();
      this.callbacks.onStatus?.('web preview listening — say AGA, stop, or pause');
      measureMark('wake.webSpeech.started');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'web speech failed to start');
      this.lastError = message;
      this.callbacks.onError?.(`web preview speech start failed: ${message}`);
    } finally {
      setTimeout(() => { this.restarting = false; }, 50);
    }
  }

  private onResult(event: any) {
    let interim = '';
    let final = '';
    for (let i = event.resultIndex || 0; i < event.results.length; i += 1) {
      const item = event.results[i];
      const text = String(item?.[0]?.transcript || '');
      if (item?.isFinal) final += text;
      else interim += text;
    }
    const partialText = normalizeSpeech(interim).trim();
    if (partialText) {
      this.lastTranscript = partialText;
      this.callbacks.onEvent({ type: 'transcript', text: partialText, final: false });
    }
    const finalText = normalizeSpeech(final).trim();
    if (!finalText) return;
    this.finalCount += 1;
    this.lastTranscript = finalText;
    this.callbacks.onEvent({ type: 'transcript', text: finalText, final: true });
    this.routeFinal(finalText);
  }

  private routeFinal(text: string) {
    const lower = text.toLowerCase();
    const control = controlFromText(lower);
    if (control) {
      this.callbacks.onEvent({ type: 'control', command: control });
      return;
    }

    const wake = detectWake(lower, this.wakePhrase);
    if (wake.woke) {
      const command = removeWakePhrase(text, this.wakePhrase).trim();
      this.armedUntil = Date.now() + numberEnv('EXPO_PUBLIC_AGA_WEB_WAKE_ARM_MS', 9000);
      this.callbacks.onEvent({ type: 'wake', text: command || undefined });
      return;
    }

    if (Date.now() < this.armedUntil) {
      this.armedUntil = 0;
      this.callbacks.onEvent({ type: 'wake', text });
    }
  }
}
