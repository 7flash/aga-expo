import { Platform } from 'react-native';
import { measureMark } from '../observability/measure';

declare function require(name: string): any;

export type PorcupineKeyword = 'aga' | 'stop' | 'pause' | string;

export type PorcupineDetection = {
  index: number;
  label: PorcupineKeyword;
  at: string;
};

export type PorcupineWakeCallbacks = {
  onDetected: (event: PorcupineDetection) => void;
  onStatus?: (status: string) => void;
  onError?: (message: string) => void;
};

function env(name: string) {
  return process.env?.[name] ?? '';
}

function listEnv(name: string, fallback: string[]) {
  const raw = env(name).trim();
  if (!raw) return fallback;
  return raw.split(',').map((part) => part.trim()).filter(Boolean);
}

function numericListEnv(name: string, count: number, fallback: number) {
  const values = listEnv(name, []).map((item) => Number(item));
  return Array.from({ length: count }, (_, index) => {
    const value = values[index];
    return Number.isFinite(value) && value > 0 && value <= 1 ? value : fallback;
  });
}

function loadPorcupineManager(): any | null {
  if (Platform.OS === 'web') return null;
  try {
    const mod = require('@picovoice/porcupine-react-native');
    return mod?.PorcupineManager ?? mod?.default?.PorcupineManager ?? null;
  } catch {
    return null;
  }
}

export class PorcupineWakeEngine {
  private manager: any | null = null;
  private callbacks: PorcupineWakeCallbacks;
  private labels: string[];
  private keywordPaths: string[];
  private started = false;

  constructor(callbacks: PorcupineWakeCallbacks) {
    this.callbacks = callbacks;
    this.labels = listEnv('EXPO_PUBLIC_AGA_PORCUPINE_KEYWORD_LABELS', ['aga', 'stop', 'pause']);
    this.keywordPaths = listEnv('EXPO_PUBLIC_AGA_PORCUPINE_KEYWORD_PATHS', ['aga.ppn', 'stop.ppn', 'pause.ppn']);
  }

  getDiagnostics() {
    return {
      provider: 'porcupine',
      available: !!loadPorcupineManager(),
      started: this.started,
      keywordPaths: this.keywordPaths,
      labels: this.labels,
    };
  }

  async start() {
    if (this.started) return;
    const accessKey = env('EXPO_PUBLIC_AGA_PORCUPINE_ACCESS_KEY') || env('PICOVOICE_ACCESS_KEY');
    if (!accessKey) throw new Error('Missing EXPO_PUBLIC_AGA_PORCUPINE_ACCESS_KEY for Porcupine wake engine.');
    if (!this.keywordPaths.length) throw new Error('Missing EXPO_PUBLIC_AGA_PORCUPINE_KEYWORD_PATHS.');

    const PorcupineManager = loadPorcupineManager();
    if (!PorcupineManager?.fromKeywordPaths) {
      throw new Error('@picovoice/porcupine-react-native is not available in this build. Run prebuild after installing it.');
    }

    const sensitivities = numericListEnv('EXPO_PUBLIC_AGA_PORCUPINE_SENSITIVITIES', this.keywordPaths.length, 0.65);
    const detectionCallback = (keywordIndex: number) => {
      const label = this.labels[keywordIndex] || `keyword_${keywordIndex}`;
      const event = { index: keywordIndex, label, at: new Date().toISOString() };
      measureMark('wake.porcupine.detected', event);
      this.callbacks.onDetected(event);
    };

    this.callbacks.onStatus?.('porcupine wake engine starting');
    try {
      this.manager = await PorcupineManager.fromKeywordPaths(accessKey, this.keywordPaths, detectionCallback, undefined, sensitivities);
      await this.manager?.start?.();
      this.started = true;
      this.callbacks.onStatus?.(`porcupine listening: ${this.labels.join(', ')}`);
      measureMark('wake.porcupine.started', { keywordPaths: this.keywordPaths.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || 'Porcupine failed to start.');
      this.callbacks.onError?.(message);
      throw error;
    }
  }

  async stop() {
    if (!this.manager && !this.started) return;
    this.callbacks.onStatus?.('porcupine wake engine stopping');
    try { await this.manager?.stop?.(); } catch { /* ignore */ }
    try { await this.manager?.delete?.(); } catch { /* ignore */ }
    this.manager = null;
    this.started = false;
    measureMark('wake.porcupine.stopped');
  }
}
