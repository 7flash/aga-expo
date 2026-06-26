import { GuidedAudioPrefetchQueue, type GuidedAudioSegment } from '../voice/guidedAudioPrefetch';
import { logEvent } from '../db/localStore';

export type GuidedPhase = 'arrival' | 'induction' | 'deepening' | 'suggestion' | 'integration' | 'emergence' | 'reflection' | 'complete';

export type DeterministicGuidedScript = {
  id: string;
  label: string;
  kind: 'breathing' | 'self_hypnosis' | 'conflict_navigation' | 'meditation' | 'body_scan' | 'bedtime' | 'focus' | 'general';
  safety: string[];
  segments: Array<GuidedAudioSegment & { phase: GuidedPhase; awaitUser?: boolean; grounding?: boolean }>;
};

export type DeterministicGuidedState = {
  scriptId: string;
  index: number;
  phase: GuidedPhase;
  paused: boolean;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
};

type RunnerCallbacks = {
  speak: (text: string, meta: { phase: GuidedPhase; audio?: unknown; segmentId: string }) => Promise<void> | void;
  onPause?: (ms: number, phase: GuidedPhase) => Promise<void> | void;
  onAwaitUser?: (phase: GuidedPhase) => Promise<void> | void;
  onComplete?: (state: DeterministicGuidedState) => Promise<void> | void;
  saveState?: (state: DeterministicGuidedState) => Promise<void> | void;
};

function now() { return new Date().toISOString(); }

/**
 * Strict local pacing engine for trance-critical experiences.
 *
 * The cloud can author/adapt the script before the session begins, but timing,
 * pauses, grounding cues, and progression are deterministic and local.
 */
export class DeterministicGuidedRunner {
  private script: DeterministicGuidedScript;
  private callbacks: RunnerCallbacks;
  private prefetch: GuidedAudioPrefetchQueue;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private state: DeterministicGuidedState;

  constructor(script: DeterministicGuidedScript, callbacks: RunnerCallbacks, prefetch = new GuidedAudioPrefetchQueue()) {
    this.script = script;
    this.callbacks = callbacks;
    this.prefetch = prefetch;
    this.state = { scriptId: script.id, index: 0, phase: script.segments[0]?.phase || 'arrival', paused: false, startedAt: now(), updatedAt: now() };
  }

  getState() { return { ...this.state }; }

  async start(index = 0) {
    this.state.index = Math.max(0, Math.min(index, this.script.segments.length - 1));
    this.state.paused = false;
    await logEvent('guided.deterministic.start', `${this.script.id}@${this.state.index}`).catch(() => undefined);
    await this.step();
  }

  async pause() {
    this.clearTimer();
    this.state.paused = true;
    this.state.updatedAt = now();
    await this.callbacks.saveState?.(this.getState());
  }

  async resume() {
    if (!this.state.paused) return;
    this.state.paused = false;
    this.state.updatedAt = now();
    await this.step();
  }

  async next() {
    this.clearTimer();
    this.state.index += 1;
    this.state.updatedAt = now();
    await this.step();
  }

  async stop() {
    this.clearTimer();
    this.prefetch.reset();
    this.state.completedAt = now();
    this.state.phase = 'complete';
    this.state.updatedAt = now();
    await this.callbacks.saveState?.(this.getState());
  }

  private async step() {
    if (this.state.paused) return;
    const segment = this.script.segments[this.state.index];
    if (!segment) {
      this.state.phase = 'complete';
      this.state.completedAt = now();
      this.state.updatedAt = now();
      await this.callbacks.saveState?.(this.getState());
      await this.callbacks.onComplete?.(this.getState());
      return;
    }

    this.state.phase = segment.phase;
    this.state.updatedAt = now();
    this.prefetch.warm(this.script.segments, this.state.index);
    const audio = await this.prefetch.get(segment);
    await this.callbacks.speak(segment.text, { phase: segment.phase, audio, segmentId: segment.id });
    await this.callbacks.saveState?.(this.getState());

    if (segment.awaitUser) {
      await this.callbacks.onAwaitUser?.(segment.phase);
      return;
    }

    const pause = Math.max(0, segment.pauseAfterMs || 0);
    if (pause) await this.callbacks.onPause?.(pause, segment.phase);
    this.clearTimer();
    this.timer = setTimeout(() => { void this.next(); }, pause);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
