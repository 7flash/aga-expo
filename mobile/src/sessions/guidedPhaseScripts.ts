export type GuidedPhaseKind = 'box_breathing' | 'hypnosis' | 'conflict' | 'meditation';

export type GuidedPhase = {
  id: string;
  label: string;
  text: string;
  pauseMs: number;
  emotion?: 'guided' | 'hypnosis' | 'conflict' | 'calm';
  waitForUser?: boolean;
  grounding?: boolean;
};

export function buildGuidedPhaseScript(kind: GuidedPhaseKind, goal?: string): GuidedPhase[] {
  const theme = goal ? ` for ${goal}` : '';
  if (kind === 'box_breathing') {
    return [
      { id: 'settle', label: 'Settle', text: 'I am here. Let your shoulders soften. We will breathe in a simple square.', pauseMs: 2500, emotion: 'guided' },
      { id: 'inhale-1', label: 'Inhale', text: 'Inhale. Two. Three. Four.', pauseMs: 1200, emotion: 'guided' },
      { id: 'hold-1', label: 'Hold', text: 'Hold. Two. Three. Four.', pauseMs: 1200, emotion: 'guided' },
      { id: 'exhale-1', label: 'Exhale', text: 'Exhale. Two. Three. Four.', pauseMs: 1200, emotion: 'guided' },
      { id: 'hold-2', label: 'Rest', text: 'Rest empty. Two. Three. Four.', pauseMs: 1200, emotion: 'guided' },
      { id: 'repeat', label: 'Repeat', text: 'Again. Smooth and easy. I will keep the rhythm.', pauseMs: 1600, emotion: 'guided' },
      { id: 'ground', label: 'Ground', text: 'Let the breath return to normal. Notice the room. You are present and steady.', pauseMs: 2500, emotion: 'guided', grounding: true },
    ];
  }
  if (kind === 'hypnosis') {
    return [
      { id: 'safety', label: 'Safety', text: 'You stay in control the whole time. If you want to stop, say stop. We will keep this gentle and grounded.', pauseMs: 2600, emotion: 'hypnosis' },
      { id: 'induction', label: 'Induction', text: 'Let your eyes rest. Feel the weight of the body supported. Nothing to force. Nothing to perform.', pauseMs: 4200, emotion: 'hypnosis' },
      { id: 'deepening', label: 'Deepening', text: 'With each slow breath, imagine the noise moving farther away. The useful part of the mind can listen quietly.', pauseMs: 5200, emotion: 'hypnosis' },
      { id: 'suggestion', label: 'Suggestion', text: `For the next few moments, let the mind rehearse ${theme || 'the change you chose'} as something safe, natural, and already beginning.`, pauseMs: 6200, emotion: 'hypnosis' },
      { id: 'integration', label: 'Integration', text: 'Let the useful part keep only what helps. Everything else can pass by.', pauseMs: 4200, emotion: 'hypnosis' },
      { id: 'emergence', label: 'Emergence', text: 'Now return gently. Feel your hands. Feel your feet. Take a fuller breath.', pauseMs: 3500, emotion: 'hypnosis', grounding: true },
      { id: 'orient', label: 'Orient', text: 'Open your attention to the room. You are awake, present, and safe.', pauseMs: 1800, emotion: 'guided', grounding: true },
    ];
  }
  if (kind === 'conflict') {
    return [
      { id: 'stabilize', label: 'Stabilize', text: 'Before solving it, we settle the body. One slow breath. You do not need to decide everything yet.', pauseMs: 2800, emotion: 'conflict' },
      { id: 'facts', label: 'Facts', text: 'Say only the facts of what happened, without judging yourself or them.', pauseMs: 1000, emotion: 'conflict', waitForUser: true },
      { id: 'need', label: 'Need', text: 'What need is underneath this? Respect, safety, honesty, space, repair, or something else?', pauseMs: 1000, emotion: 'conflict', waitForUser: true },
      { id: 'perspective', label: 'Perspective', text: 'Now imagine the other person’s fear or need, without excusing harm.', pauseMs: 1000, emotion: 'conflict', waitForUser: true },
      { id: 'outcome', label: 'Outcome', text: 'What outcome would feel fair and calm tomorrow?', pauseMs: 1000, emotion: 'conflict', waitForUser: true },
      { id: 'ground', label: 'Ground', text: 'Good. Let the body come back to now. We can turn this into words when you are ready.', pauseMs: 2200, emotion: 'conflict', grounding: true },
    ];
  }
  return [
    { id: 'arrive', label: 'Arrive', text: 'Arrive here. Let the breath be natural.', pauseMs: 2500, emotion: 'guided' },
    { id: 'body', label: 'Body', text: 'Notice the face, the jaw, the chest, and the belly. Let each place soften by one percent.', pauseMs: 5200, emotion: 'guided' },
    { id: 'quiet', label: 'Quiet', text: 'No need to empty the mind. Let sounds and thoughts pass like distant weather.', pauseMs: 6200, emotion: 'guided' },
    { id: 'return', label: 'Return', text: 'Return gently to the room. You are here.', pauseMs: 2500, emotion: 'guided', grounding: true },
  ];
}

export function guidedKindFromText(text: string): GuidedPhaseKind | null {
  const clean = String(text || '').toLowerCase();
  if (/box|square|breath|breathe/.test(clean)) return 'box_breathing';
  if (/hypnosis|self hypnosis|trance|subconscious/.test(clean)) return 'hypnosis';
  if (/conflict|argument|fight|relationship|resolve/.test(clean)) return 'conflict';
  if (/meditation|calm|wind down|sleep/.test(clean)) return 'meditation';
  return null;
}
