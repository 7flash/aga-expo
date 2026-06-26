import { addMemory, logEvent } from '../db/localStore';
import { speakText, stopTts } from '../voice/tts';
import { buildGuidedPhaseScript, guidedKindFromText, type GuidedPhase, type GuidedPhaseKind } from './guidedPhaseScripts';
import { GuidedAudioPrefetchQueue } from './guidedAudioPrefetch';

type Listener = (state: GuidedRunnerSnapshot) => void;

export type GuidedRunnerSnapshot = {
  active: boolean;
  kind: GuidedPhaseKind | null;
  goal: string | null;
  phaseIndex: number;
  phaseLabel: string | null;
  paused: boolean;
  waitingForUser: boolean;
  startedAt: string | null;
};

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export class DeterministicGuidedRunner {
  private listeners = new Set<Listener>();
  private phases: GuidedPhase[] = [];
  private snapshot: GuidedRunnerSnapshot = { active: false, kind: null, goal: null, phaseIndex: 0, phaseLabel: null, paused: false, waitingForUser: false, startedAt: null };
  private stopped = false;
  private prefetch = new GuidedAudioPrefetchQueue();

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  private publish(patch: Partial<GuidedRunnerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  canStartFromText(text: string) {
    return !!guidedKindFromText(text);
  }

  async start(kindOrText: GuidedPhaseKind | string, goal?: string) {
    const kind = (['box_breathing', 'hypnosis', 'conflict', 'meditation'].includes(kindOrText) ? kindOrText : guidedKindFromText(kindOrText)) as GuidedPhaseKind | null;
    if (!kind) return false;
    await this.stop('restart');
    this.stopped = false;
    this.phases = buildGuidedPhaseScript(kind, goal);
    this.publish({ active: true, kind, goal: goal || null, phaseIndex: 0, phaseLabel: this.phases[0]?.label || null, paused: false, waitingForUser: false, startedAt: new Date().toISOString() });
    await logEvent('guided.deterministic.start', `${kind}${goal ? ` goal=${goal}` : ''}`).catch(() => undefined);
    void this.run();
    return true;
  }

  async control(command: 'pause' | 'resume' | 'deeper' | 'skip' | 'repeat' | 'end') {
    if (!this.snapshot.active) return 'No guided session is active.';
    if (command === 'end') {
      await this.stop('user_end');
      await speakText('Session ended. Feel your feet, notice the room, and take one normal breath.', { emotion: 'guided', provider: 'auto' });
      return 'Session ended.';
    }
    if (command === 'pause') {
      this.publish({ paused: true });
      await stopTts();
      return 'Paused.';
    }
    if (command === 'resume') {
      this.publish({ paused: false, waitingForUser: false });
      void this.run(this.snapshot.phaseIndex);
      return 'Resuming.';
    }
    if (command === 'skip') {
      this.publish({ phaseIndex: Math.min(this.phases.length - 1, this.snapshot.phaseIndex + 1), waitingForUser: false });
      void this.run(this.snapshot.phaseIndex);
      return 'Skipping.';
    }
    if (command === 'repeat') {
      this.publish({ waitingForUser: false });
      void this.run(this.snapshot.phaseIndex);
      return 'Repeating.';
    }
    if (command === 'deeper') {
      await speakText('Good. Slower now. Let the body be heavier, while the observing part stays clear and safe.', { emotion: 'hypnosis', provider: 'auto' });
      return 'Going deeper.';
    }
    return 'Done.';
  }

  async acceptUserResponse(text: string) {
    if (!this.snapshot.waitingForUser) return false;
    await addMemory(`Guided ${this.snapshot.kind} response: ${String(text || '').slice(0, 500)}`).catch(() => undefined);
    this.publish({ waitingForUser: false, phaseIndex: Math.min(this.phases.length - 1, this.snapshot.phaseIndex + 1) });
    void this.run(this.snapshot.phaseIndex);
    return true;
  }

  async stop(reason = 'stop') {
    this.stopped = true;
    await stopTts().catch(() => undefined);
    if (this.snapshot.active) await logEvent('guided.deterministic.stop', reason).catch(() => undefined);
    this.publish({ active: false, kind: null, goal: null, paused: false, waitingForUser: false, phaseLabel: null });
  }

  private async run(startIndex = this.snapshot.phaseIndex) {
    for (let i = startIndex; i < this.phases.length; i += 1) {
      if (this.stopped || !this.snapshot.active) return;
      while (this.snapshot.paused) await delay(250);
      const phase = this.phases[i];
      this.publish({ phaseIndex: i, phaseLabel: phase.label, waitingForUser: false });
      this.prefetch.warm(this.phases, i + 1);
      await this.prefetch.speak(phase);
      if (phase.waitForUser) {
        this.publish({ waitingForUser: true });
        return;
      }
      await delay(phase.pauseMs);
    }
    const summary = `Completed ${this.snapshot.kind}${this.snapshot.goal ? ` for ${this.snapshot.goal}` : ''}.`;
    await addMemory(`Guided session reflection: ${summary}`).catch(() => undefined);
    await logEvent('guided.deterministic.complete', summary).catch(() => undefined);
    this.publish({ active: false, kind: null, goal: null, paused: false, waitingForUser: false, phaseLabel: null });
  }
}
