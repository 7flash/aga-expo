import type { DeterministicGuidedScript } from './deterministicGuidedRunner';

function seg(id: string, phase: DeterministicGuidedScript['segments'][number]['phase'], text: string, pauseAfterMs: number, extra: Partial<DeterministicGuidedScript['segments'][number]> = {}) {
  return { id, phase, text, pauseAfterMs, ...extra };
}

export function buildSafeSelfHypnosisScript(goal: string, minutes = 8): DeterministicGuidedScript {
  const safeGoal = goal.trim() || 'calm confidence';
  const scale = Math.max(0.75, Math.min(1.8, minutes / 8));
  const p = (ms: number) => Math.round(ms * scale);
  return {
    id: `self_hypnosis_${Date.now()}`,
    label: `Self-hypnosis: ${safeGoal}`,
    kind: 'self_hypnosis',
    safety: [
      'The user can stop, pause, or return to present at any time.',
      'Use consent-based, positive suggestions only.',
      'Avoid medical promises, coercive language, or claims of control.',
      'Always end with grounding and present-time orientation.',
    ],
    segments: [
      seg('arrival_1', 'arrival', 'Settle in. You are in control of this session. If you want to stop, say AGA stop session.', p(4200)),
      seg('induction_1', 'induction', 'Let your eyes rest. Breathe in slowly, and breathe out as if the body is putting down a small weight.', p(6200)),
      seg('induction_2', 'induction', 'With every out breath, the surface beneath you can feel a little more supportive.', p(7200)),
      seg('deepening_1', 'deepening', 'Imagine descending three gentle steps. Three. The jaw softens. Two. The shoulders release. One. The mind becomes quiet and clear.', p(9200)),
      seg('suggestion_1', 'suggestion', `Now bring in the intention: ${safeGoal}. Let it be simple, kind, and chosen by you.`, p(7800)),
      seg('suggestion_2', 'suggestion', `A useful part of you can practice ${safeGoal} in small real moments, without force, without pressure, one calm choice at a time.`, p(9000)),
      seg('integration_1', 'integration', 'Let the mind keep only what is helpful and release everything else. The body can remember the feeling of steadiness.', p(7600)),
      seg('emergence_1', 'emergence', 'Begin returning to the room. Feel your hands, your feet, and the air around you.', p(5400), { grounding: true }),
      seg('emergence_2', 'emergence', 'When you are ready, take a fuller breath. You are present, awake, and grounded.', p(2600), { grounding: true }),
      seg('reflection_1', 'reflection', 'Would you like me to remember what helped from this session?', 0, { awaitUser: true }),
    ],
  };
}

export function buildBoxBreathingScript(rounds = 4): DeterministicGuidedScript {
  const segments: DeterministicGuidedScript['segments'] = [
    seg('arrival', 'arrival', 'We will do box breathing. I will keep the timing. You only need to follow.', 3000),
  ];
  for (let i = 1; i <= Math.max(1, Math.min(8, rounds)); i += 1) {
    segments.push(seg(`r${i}_in`, 'induction', 'Breathe in. Two. Three. Four.', 4200));
    segments.push(seg(`r${i}_hold1`, 'deepening', 'Hold. Two. Three. Four.', 4200));
    segments.push(seg(`r${i}_out`, 'deepening', 'Breathe out. Two. Three. Four.', 4200));
    segments.push(seg(`r${i}_hold2`, 'deepening', 'Hold empty. Two. Three. Four.', 4200));
  }
  segments.push(seg('ground', 'emergence', 'Let your breathing return to normal. Notice what changed.', 4000, { grounding: true }));
  return { id: `box_breathing_${Date.now()}`, label: 'Box breathing', kind: 'breathing', safety: ['Stop immediately if the user feels uncomfortable.', 'Keep deterministic cadence.'], segments };
}
