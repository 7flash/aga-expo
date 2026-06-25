import { normalizeSpeech } from './text';

export class FinalSpeechDeduper {
  private lastKey = '';
  private lastAt = 0;

  constructor(private readonly windowMs = 2400) {}

  shouldDrop(text: string) {
    const key = normalizeSpeech(text).toLowerCase();
    const now = Date.now();
    const duplicate = !!key && key === this.lastKey && now - this.lastAt < this.windowMs;
    this.lastKey = key;
    this.lastAt = now;
    return duplicate;
  }

  reset() {
    this.lastKey = '';
    this.lastAt = 0;
  }
}

export class SerialTurnQueue {
  private tail = Promise.resolve();
  private stopped = false;

  enqueue(work: () => Promise<void>) {
    if (this.stopped) return;
    this.tail = this.tail
      .catch(() => undefined)
      .then(async () => {
        if (!this.stopped) await work();
      });
  }

  async drain() {
    await this.tail.catch(() => undefined);
  }

  stop() {
    this.stopped = true;
  }
}
