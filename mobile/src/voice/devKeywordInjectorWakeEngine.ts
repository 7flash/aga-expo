export type DevKeywordInjectorCallbacks = {
  onWake: (label: string) => void;
  onControl: (command: 'stop' | 'pause' | 'resume') => void;
  onStatus?: (status: string) => void;
  onError?: (message: string) => void;
};

declare global {
  // Development hooks for web/kiosk preview. These do not exist in production.
  // eslint-disable-next-line no-var
  var __AGA_WAKE: undefined | ((label?: string) => void);
  // eslint-disable-next-line no-var
  var __AGA_STOP: undefined | (() => void);
  // eslint-disable-next-line no-var
  var __AGA_PAUSE: undefined | (() => void);
  // eslint-disable-next-line no-var
  var __AGA_RESUME: undefined | (() => void);
}

function root(): any {
  return globalThis as any;
}

function normalizeLabel(label?: string) {
  const clean = String(label || 'aga').trim().toLowerCase();
  return clean || 'aga';
}

/**
 * No-mic development wake engine.
 *
 * This deliberately does not transcribe speech. It only injects the same keyword
 * events that Porcupine would emit so the browser preview can test routing and
 * tactile feedback without pretending SpeechRecognition is the product path.
 */
export class DevKeywordInjectorWakeEngine {
  private callbacks: DevKeywordInjectorCallbacks;
  private reason: string;
  private running = false;
  private detections = 0;

  constructor(callbacks: DevKeywordInjectorCallbacks, reason = 'dev keyword injector') {
    this.callbacks = callbacks;
    this.reason = reason;
  }

  getDiagnostics() {
    return {
      provider: 'dev-keyword-injector',
      running: this.running,
      detections: this.detections,
      commands: ['__AGA_WAKE()', '__AGA_STOP()', '__AGA_PAUSE()', '__AGA_RESUME()'],
      reason: this.reason,
    };
  }

  async start() {
    if (this.running) return;
    this.running = true;
    const g = root();
    g.__AGA_WAKE = (label?: string) => {
      if (!this.running) return;
      this.detections += 1;
      this.callbacks.onWake(normalizeLabel(label));
    };
    g.__AGA_STOP = () => {
      if (!this.running) return;
      this.detections += 1;
      this.callbacks.onControl('stop');
    };
    g.__AGA_PAUSE = () => {
      if (!this.running) return;
      this.detections += 1;
      this.callbacks.onControl('pause');
    };
    g.__AGA_RESUME = () => {
      if (!this.running) return;
      this.detections += 1;
      this.callbacks.onControl('resume');
    };
    this.callbacks.onStatus?.('dev keyword injector ready: call __AGA_WAKE(), __AGA_STOP(), or __AGA_PAUSE()');
  }

  async stop() {
    this.running = false;
    const g = root();
    if (g.__AGA_WAKE) g.__AGA_WAKE = undefined;
    if (g.__AGA_STOP) g.__AGA_STOP = undefined;
    if (g.__AGA_PAUSE) g.__AGA_PAUSE = undefined;
    if (g.__AGA_RESUME) g.__AGA_RESUME = undefined;
    this.callbacks.onStatus?.('dev keyword injector stopped');
  }
}
