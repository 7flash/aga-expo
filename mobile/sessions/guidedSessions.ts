export type GuidedSessionKind =
  | 'breathing'
  | 'body_scan'
  | 'self_hypnosis'
  | 'conflict_navigation'
  | 'imagination'
  | 'music'
  | 'language'
  | 'focus'
  | 'bedtime'
  | 'general';

export type GuidedSessionPhase =
  | 'orientation'
  | 'induction'
  | 'deepening'
  | 'suggestion'
  | 'integration'
  | 'emergence'
  | 'reflection';

export type GuidedSessionSegment = {
  id: string;
  title: string;
  prompt: string;
  phase?: GuidedSessionPhase;
  durationSec?: number;
  waitForUser?: boolean;
  pace?: 'normal' | 'slow' | 'whisper';
  background?: 'none' | 'rain' | 'ocean' | 'forest' | 'brown_noise' | 'ambient';
};

export type GuidedSessionPreset = {
  id: string;
  kind: GuidedSessionKind;
  label: string;
  description: string;
  aliases: string[];
  theme?: string;
  safety?: string;
  opening: string;
  instructions: string;
  segments: GuidedSessionSegment[];
};

export const GUIDED_SESSION_PRESETS: GuidedSessionPreset[] = [
  {
    id: 'guided_breathing_reset',
    kind: 'breathing',
    label: 'Nervous system reset',
    description: 'A short physiological sigh and box-breath reset.',
    aliases: ['breathing', 'breathe', 'calm down', 'reset', 'anxiety', 'meditation', 'nervous system'],
    theme: 'nervous system reset',
    opening: 'Let us do a short nervous system reset. I will keep it gentle and simple.',
    instructions:
      'Guide a 3 to 5 minute nervous-system reset. Use slow pacing, short sentences, and clear breath counts. Ask for consent before continuing longer. Let the user say pause, next, deeper, repeat, skip, or end session.',
    segments: [
      { id: 'arrive', title: 'Arrive', phase: 'orientation', prompt: 'Notice your feet. Let your shoulders drop one millimeter.', durationSec: 20, pace: 'slow', background: 'ambient' },
      { id: 'sigh', title: 'Physiological sigh', phase: 'induction', prompt: 'Inhale through the nose. Add a tiny second inhale. Long soft exhale.', durationSec: 45, pace: 'slow', background: 'breathing' as any },
      { id: 'box', title: 'Box breath', phase: 'deepening', prompt: 'Inhale four. Hold four. Exhale four. Hold four. I will count softly.', durationSec: 80, pace: 'slow', background: 'brown_noise' },
      { id: 'orient', title: 'Orient', phase: 'integration', prompt: 'Let the breath go natural. Look for one thing in the room that tells your body it is safe enough right now.', durationSec: 30, pace: 'slow' },
      { id: 'check', title: 'Check in', phase: 'reflection', prompt: 'What changed in your body, even a little?', waitForUser: true, pace: 'slow' },
    ],
  },
  {
    id: 'guided_body_scan',
    kind: 'body_scan',
    label: 'Body scan',
    description: 'Progressive relaxation from face to feet.',
    aliases: ['body scan', 'relax my body', 'progressive relaxation', 'tension', 'wind down', 'sleep ritual'],
    theme: 'body scan relaxation',
    opening: 'I will guide a soft body scan. You do not need to do it perfectly.',
    instructions:
      'Guide a progressive muscle relaxation/body scan. Move slowly from face to jaw to chest to belly to hands to legs. Invite awareness, not force. If the user reports discomfort, slow down and ground.',
    segments: [
      { id: 'permission', title: 'Permission', phase: 'orientation', prompt: 'Let your attention be kind, not strict. You can skip any area.', durationSec: 20, pace: 'slow', background: 'brown_noise' },
      { id: 'face', title: 'Face and jaw', phase: 'induction', prompt: 'Soften the forehead. Unclench the jaw. Let the tongue rest.', durationSec: 45, pace: 'slow' },
      { id: 'chest', title: 'Chest and breath', phase: 'deepening', prompt: 'Notice the chest. Let the breath be easy rather than deep.', durationSec: 55, pace: 'slow' },
      { id: 'hands', title: 'Hands', phase: 'deepening', prompt: 'Feel the hands from the inside. Warm, cool, tingling, or neutral is all okay.', durationSec: 45, pace: 'slow' },
      { id: 'legs', title: 'Legs and feet', phase: 'integration', prompt: 'Let the legs be held by the ground. Feel the feet heavy and safe.', durationSec: 60, pace: 'slow' },
      { id: 'sleep-bridge', title: 'Sleep bridge', phase: 'reflection', prompt: 'Would you like to continue into a bedtime wind-down, or stop here?', waitForUser: true, pace: 'slow' },
    ],
  },
  {
    id: 'guided_self_hypnosis',
    kind: 'self_hypnosis',
    label: 'Safe self-hypnosis',
    description: 'Ethical positive suggestion with user-chosen goal.',
    aliases: ['hypnosis', 'self hypnosis', 'subconscious', 'affirmation', 'reprogramming', 'deep suggestion'],
    theme: 'safe self hypnosis',
    safety:
      'Only use positive, consent-based suggestions. Do not claim control over the user. Avoid medical promises. Invite the user to stay aware and able to stop at any time. End with grounding and present-time orientation.',
    opening: 'We can do safe self-hypnosis. Tell me the positive goal you want to support, or say start with calm confidence.',
    instructions:
      'Run a safe, ethical self-hypnosis session with explicit phases: orientation, induction, deepening, suggestion, integration, emergence, reflection. First ask for the user’s chosen positive goal if unknown. Use permissive language: you may, you can, if it feels right. Keep the user in control and able to end any time.',
    segments: [
      { id: 'goal', title: 'Choose goal', phase: 'orientation', prompt: 'What positive goal should this session support? Phrase it as something you want to move toward.', waitForUser: true, pace: 'slow' },
      { id: 'consent', title: 'Consent and control', phase: 'orientation', prompt: 'You stay in control. Any suggestion is only an invitation. You can pause, skip, or end at any time.', durationSec: 25, pace: 'slow' },
      { id: 'induction', title: 'Induction', phase: 'induction', prompt: 'Let your eyes soften. Count down from five, and with each number, release a little effort.', durationSec: 90, pace: 'whisper', background: 'brown_noise' },
      { id: 'deepening', title: 'Deepening', phase: 'deepening', prompt: 'Imagine a gentle stairway or path. With every step, you become more comfortable, while a steady aware part of you remains present.', durationSec: 80, pace: 'whisper' },
      { id: 'suggestion', title: 'Positive suggestion', phase: 'suggestion', prompt: 'Repeat the chosen goal as a gentle possibility: I can practice this, one small moment at a time. Never force it.', durationSec: 90, pace: 'whisper' },
      { id: 'integration', title: 'Integration', phase: 'integration', prompt: 'Let the useful part become a small signal you can return to later: a breath, a hand on heart, or one quiet phrase.', durationSec: 45, pace: 'slow' },
      { id: 'return', title: 'Return', phase: 'emergence', prompt: 'Come back slowly. Notice the room. Move fingers and toes. Bring the useful part with you.', durationSec: 35, pace: 'slow' },
      { id: 'reflection', title: 'Reflection', phase: 'reflection', prompt: 'What suggestion or image felt useful enough for me to remember?', waitForUser: true, pace: 'slow' },
    ],
  },
  {
    id: 'guided_conflict_navigation',
    kind: 'conflict_navigation',
    label: 'Conflict navigation',
    description: 'A structured emotional processing flow.',
    aliases: ['conflict', 'argument', 'relationship', 'emotional processing', 'help me understand', 'resolve conflict', 'fight'],
    theme: 'conflict resolution',
    safety:
      'Do not diagnose, shame, or force forgiveness. If there is danger or abuse, prioritize safety, boundaries, and real-world support. Ask one question at a time.',
    opening: 'I can help you untangle this gently. Start with one sentence: what happened?',
    instructions:
      'Guide conflict navigation using active listening, parts language, perspective taking, needs, boundaries, and fair next steps. Do not judge or diagnose. Reflect feelings and needs, then offer numbered next steps.',
    segments: [
      { id: 'story', title: 'What happened', phase: 'orientation', prompt: 'Tell me the simplest version of what happened, in one or two sentences.', waitForUser: true },
      { id: 'feeling', title: 'Feeling', phase: 'deepening', prompt: 'What feeling is strongest right now: hurt, anger, fear, shame, sadness, or something else?', waitForUser: true },
      { id: 'need', title: 'Need', phase: 'deepening', prompt: 'What part of you needs to be heard, protected, respected, or repaired?', waitForUser: true },
      { id: 'other-side', title: 'Other perspective', phase: 'integration', prompt: 'Without excusing anything, what might the other person have been protecting or misunderstanding?', waitForUser: true },
      { id: 'fair-outcome', title: 'Fair outcome', phase: 'integration', prompt: 'What outcome would feel fair enough: apology, space, clarity, boundary, repair, or closure?', waitForUser: true },
      { id: 'words', title: 'Words to say', phase: 'suggestion', prompt: 'Choose one: I can help you soothe first, understand their perspective, or draft words to say.', waitForUser: true },
      { id: 'resolution-note', title: 'Resolution note', phase: 'reflection', prompt: 'What should I remember about what helped you handle this conflict?', waitForUser: true },
    ],
  },
];

export function findGuidedSession(input: unknown): GuidedSessionPreset | null {
  const clean = String(input ?? '').toLowerCase().trim();
  if (!clean) return null;
  return GUIDED_SESSION_PRESETS.find((preset) => {
    if (preset.id === clean || preset.kind === clean || preset.label.toLowerCase() === clean) return true;
    return preset.aliases.some((alias) => clean.includes(alias.toLowerCase()) || alias.toLowerCase().includes(clean));
  }) ?? null;
}

export function buildGuidedSessionInstructions(preset: GuidedSessionPreset) {
  const script = preset.segments.map((segment, index) => {
    const flags = [
      segment.phase ? `phase=${segment.phase}` : null,
      segment.durationSec ? `${segment.durationSec}s` : null,
      segment.waitForUser ? 'wait for user' : null,
      segment.pace ? `pace=${segment.pace}` : null,
      segment.background ? `background=${segment.background}` : null,
    ].filter(Boolean).join(', ');
    return `${index + 1}. ${segment.title}${flags ? ` (${flags})` : ''}: ${segment.prompt}`;
  }).join('\n');

  return [
    `Guided session: ${preset.label}.`,
    preset.description,
    preset.safety ? `Safety: ${preset.safety}` : '',
    preset.instructions,
    'Run the session as a stateful voice experience. Do not dump the whole script at once. Speak one segment, then wait when a segment says wait for user.',
    'The user may say pause, resume, next, deeper, skip, repeat, or end session. Use guided_session_control for these controls when appropriate.',
    'After meaningful work, call reflect_session and update_user_profile with what helped, but do not store intimate raw transcript.',
    `Script:\n${script}`,
  ].filter(Boolean).join('\n');
}

export function guidedSessionOpening(preset: GuidedSessionPreset) {
  return preset.opening || `Starting ${preset.label}.`;
}
