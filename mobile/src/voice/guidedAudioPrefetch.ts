import { logEvent } from '../db/localStore';

export type GuidedAudioSegment = {
  id: string;
  text: string;
  pauseAfterMs: number;
  voice?: string;
};

export type PrefetchedAudio = {
  id: string;
  text: string;
  uri?: string;
  base64?: string;
  mimeType?: string;
  readyAt: string;
};

export type AudioPrefetchProvider = (segment: GuidedAudioSegment) => Promise<PrefetchedAudio>;

function defaultProvider(): AudioPrefetchProvider {
  return async (segment) => ({ id: segment.id, text: segment.text, readyAt: new Date().toISOString() });
}

/**
 * Keeps the next guided-session audio buffers warm without letting cloud TTS
 * dictate pacing. A real provider can call OpenAI/Gemini/server TTS; the runner
 * still advances from a deterministic local clock.
 */
export class GuidedAudioPrefetchQueue {
  private provider: AudioPrefetchProvider;
  private cache = new Map<string, Promise<PrefetchedAudio>>();
  private windowSize: number;

  constructor(provider: AudioPrefetchProvider = defaultProvider(), windowSize = 3) {
    this.provider = provider;
    this.windowSize = Math.max(1, windowSize);
  }

  warm(segments: GuidedAudioSegment[], currentIndex: number) {
    const next = segments.slice(currentIndex, currentIndex + this.windowSize);
    for (const segment of next) {
      if (!this.cache.has(segment.id)) {
        this.cache.set(segment.id, this.provider(segment).catch(async (error) => {
          await logEvent('guided.audio_prefetch.error', `${segment.id}: ${error instanceof Error ? error.message : String(error)}`).catch(() => undefined);
          return { id: segment.id, text: segment.text, readyAt: new Date().toISOString() };
        }));
      }
    }
  }

  async get(segment: GuidedAudioSegment) {
    if (!this.cache.has(segment.id)) this.cache.set(segment.id, this.provider(segment));
    return this.cache.get(segment.id)!;
  }

  clearBefore(segments: GuidedAudioSegment[], index: number) {
    const keep = new Set(segments.slice(Math.max(0, index - 1), index + this.windowSize).map((segment) => segment.id));
    for (const key of this.cache.keys()) if (!keep.has(key)) this.cache.delete(key);
  }

  reset() { this.cache.clear(); }
}
