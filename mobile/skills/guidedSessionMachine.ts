import { findGuidedSession, type GuidedSessionPreset, type GuidedSessionSegment, type GuidedSessionKind } from '../sessions/guidedSessions';
import {
  completeGuidedSessionState,
  loadGuidedSessionState,
  saveGuidedSessionState,
  type GuidedSessionStoreState,
} from '../db/localStore';

export type GuidedPhase =
  | 'orientation'
  | 'induction'
  | 'deepening'
  | 'suggestion'
  | 'integration'
  | 'emergence'
  | 'reflection'
  | 'complete';

export type GuidedCue = {
  sessionId: string;
  label: string;
  phase: GuidedPhase;
  segmentId?: string;
  speech: string;
  waitForUser: boolean;
  background?: GuidedSessionSegment['background'];
  pace?: GuidedSessionSegment['pace'];
  completed?: boolean;
  reflectionPrompt?: boolean;
};

function id() {
  return `guided_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function clampIndex(index: number, preset: GuidedSessionPreset) {
  return Math.max(0, Math.min(preset.segments.length, Math.floor(index || 0)));
}

function phaseFor(kind: GuidedSessionKind, index: number, segment: GuidedSessionSegment | null): GuidedPhase {
  if (!segment) return 'reflection';
  if (kind === 'self_hypnosis') {
    if (segment.id === 'goal') return 'orientation';
    if (segment.id === 'induction') return 'induction';
    if (segment.id === 'suggestion') return 'suggestion';
    if (segment.id === 'return') return 'emergence';
  }
  if (kind === 'conflict_navigation') {
    if (index <= 0) return 'orientation';
    if (index === 1) return 'deepening';
    if (index === 2) return 'integration';
    return 'reflection';
  }
  if (index === 0) return 'orientation';
  if (index === 1) return kind === 'body_scan' ? 'deepening' : 'induction';
  if (index >= 2 && index < 4) return kind === 'breathing' || kind === 'focus' ? 'integration' : 'deepening';
  return 'reflection';
}

function stateFromPreset(preset: GuidedSessionPreset, goal?: string | null): GuidedSessionStoreState {
  return {
    id: id(),
    presetId: preset.id,
    kind: preset.kind,
    label: preset.label,
    goal: goal ?? preset.theme ?? null,
    phase: 'orientation',
    segmentIndex: 0,
    paused: false,
    depth: 0,
    userResponses: [],
    lastCue: null,
    safetyFlags: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };
}

function cueFromState(preset: GuidedSessionPreset, state: GuidedSessionStoreState): GuidedCue {
  const index = clampIndex(state.segmentIndex, preset);
  const segment = preset.segments[index] ?? null;
  const phase = phaseFor(preset.kind, index, segment) as GuidedPhase;

  if (!segment) {
    return {
      sessionId: state.id,
      label: preset.label,
      phase: 'reflection',
      speech: groundingClose(preset, state),
      waitForUser: true,
      completed: true,
      reflectionPrompt: true,
    };
  }

  const goal = state.goal ? ` Theme: ${state.goal}.` : '';
  const depth = state.depth > 0 ? ` We can go a little deeper, while staying fully safe and able to stop.` : '';
  const safety = preset.safety && index === 0 ? ` Safety first: you remain in control and can say pause, skip, or end session at any time.` : '';
  const cue = `${segment.prompt}${goal}${depth}${safety}`.replace(/\s+/g, ' ').trim();

  return {
    sessionId: state.id,
    label: preset.label,
    phase,
    segmentId: segment.id,
    speech: cue,
    waitForUser: !!segment.waitForUser,
    background: segment.background,
    pace: segment.pace,
  };
}

function groundingClose(preset: GuidedSessionPreset, state: GuidedSessionStoreState) {
  if (preset.kind === 'self_hypnosis') {
    return 'Begin returning fully to the present. Notice the room, your breath, and the support under you. Take what was useful, leave the rest, and when ready tell me what helped.';
  }
  if (preset.kind === 'conflict_navigation') {
    return 'Let us land this gently. Name one fair next step, one boundary, or one kind sentence you may want to use. What should I remember from this?';
  }
  const goal = state.goal ? ` toward ${state.goal}` : '';
  return `Session complete${goal}. Notice one thing that changed in your body or mood. What should I remember helped you?`;
}

async function persistCue(preset: GuidedSessionPreset, state: GuidedSessionStoreState, cue: GuidedCue) {
  const next = { ...state, phase: cue.phase, lastCue: cue.speech, updatedAt: new Date().toISOString() };
  await saveGuidedSessionState(next);
  return cue;
}

export async function startGuidedStatefulSession(kindOrAlias: unknown, goal?: string | null) {
  const preset = findGuidedSession(kindOrAlias) ?? findGuidedSession('breathing');
  if (!preset) return null;
  const state = stateFromPreset(preset, goal);
  await saveGuidedSessionState(state);
  return persistCue(preset, state, cueFromState(preset, state));
}

export async function getCurrentGuidedCue() {
  const state = await loadGuidedSessionState();
  if (!state) return null;
  const preset = findGuidedSession(state.presetId) ?? findGuidedSession(state.kind);
  if (!preset) return null;
  return cueFromState(preset, state);
}

export async function controlGuidedStatefulSession(command: unknown, userText?: string | null) {
  const cmd = String(command || '').trim().toLowerCase();
  const state = await loadGuidedSessionState();
  if (!state) return { speech: 'No guided session is active.', completed: true } as GuidedCue;
  const preset = findGuidedSession(state.presetId) ?? findGuidedSession(state.kind);
  if (!preset) return { speech: 'The active guided session could not be restored.', completed: true } as GuidedCue;

  if (userText && userText.trim()) state.userResponses = [...(state.userResponses || []), userText.trim()].slice(-12);

  if (cmd === 'pause') {
    const next = { ...state, paused: true, updatedAt: new Date().toISOString() };
    await saveGuidedSessionState(next);
    return { sessionId: state.id, label: state.label, phase: state.phase as GuidedPhase, speech: 'Paused. Say AGA resume when you are ready.', waitForUser: true };
  }
  if (cmd === 'resume') {
    const next = { ...state, paused: false, updatedAt: new Date().toISOString() };
    await saveGuidedSessionState(next);
    return persistCue(preset, next, cueFromState(preset, next));
  }
  if (cmd === 'repeat') return persistCue(preset, state, cueFromState(preset, state));
  if (cmd === 'deeper') {
    const next = { ...state, depth: Math.min(3, state.depth + 1), updatedAt: new Date().toISOString() };
    await saveGuidedSessionState(next);
    return persistCue(preset, next, cueFromState(preset, next));
  }
  if (cmd === 'end') {
    await completeGuidedSessionState(state.id);
    return { sessionId: state.id, label: state.label, phase: 'complete', speech: 'Session ended. Return fully to the room. Feel your feet and take one normal breath.', waitForUser: false, completed: true };
  }

  const advance = cmd === 'skip' ? 2 : 1;
  const next = {
    ...state,
    paused: false,
    segmentIndex: clampIndex(state.segmentIndex + advance, preset),
    updatedAt: new Date().toISOString(),
  };
  const cue = cueFromState(preset, next);
  if (cue.completed) await completeGuidedSessionState(state.id);
  else await saveGuidedSessionState(next);
  return cue;
}

export function guidedCueToSpeech(opening: string | null | undefined, cue: GuidedCue) {
  const prefix = opening ? `${opening} ` : '';
  const wait = cue.waitForUser ? ' I will wait for your answer.' : '';
  return `${prefix}${cue.speech}${wait}`.replace(/\s+/g, ' ').trim();
}
