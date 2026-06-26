import { speakText, type TtsEmotion } from '../voice/tts';
import type { GuidedPhase } from './guidedPhaseScripts';

export type PrefetchQueueStatus = {
  queued: number;
  startedAt: string | null;
};

/**
 * Lightweight prefetch placeholder.
 *
 * Current Expo playback path writes MP3s to cache at speak time. This queue warms
 * the provider by requesting the next segment only when native stream caching is
 * unavailable. It is intentionally conservative to avoid speaking ahead.
 */
export class GuidedAudioPrefetchQueue {
  private queued = new Set<string>();
  private startedAt: string | null = null;

  status(): PrefetchQueueStatus {
    return { queued: this.queued.size, startedAt: this.startedAt };
  }

  warm(phases: GuidedPhase[], fromIndex: number) {
    this.startedAt = this.startedAt || new Date().toISOString();
    for (const phase of phases.slice(fromIndex, fromIndex + 3)) {
      if (this.queued.has(phase.id)) continue;
      this.queued.add(phase.id);
      // For direct HTTP TTS, the actual audio file is created at speak time.
      // This hook is where a native streaming cache can be connected later.
    }
  }

  async speak(phase: GuidedPhase) {
    await speakText(phase.text, { emotion: (phase.emotion || 'guided') as TtsEmotion, provider: 'auto', interrupt: true });
  }
}
