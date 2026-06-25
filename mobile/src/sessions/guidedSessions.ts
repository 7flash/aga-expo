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

export type GuidedSessionSegment = {
  id: string;
  title: string;
  prompt: string;
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
    aliases: ['breathing', 'breathe', 'calm down', 'reset', 'anxiety'],
    theme: 'nervous system reset',
    opening: 'Let us do a short nervous system reset. I will keep it gentle and simple.',
    instructions:
      'Guide a 3 to 5 minute nervous-system reset. Use slow pacing, short sentences, and clear breath counts. Ask for consent before continuing longer. Let the user say pause, deeper, skip, or end session.',
    segments: [
      { id: 'arrive', title: 'Arrive', prompt: 'Notice your feet. Let your shoulders drop one millimeter.', durationSec: 20, pace: 'slow' },
      { id: 'sigh', title: 'Physiological sigh', prompt: 'Inhale through the nose. Add a tiny second inhale. Long soft exhale.', durationSec: 45, pace: 'slow' },
      { id: 'box', title: 'Box breath', prompt: 'Inhale four. Hold four. Exhale four. Hold four.', durationSec: 80, pace: 'slow' },
      { id: 'check', title: 'Check in', prompt: 'What changed in your body, even a little?', waitForUser: true, pace: 'slow' },
    ],
  },
  {
    id: 'guided_body_scan',
    kind: 'body_scan',
    label: 'Body scan',
    description: 'Progressive relaxation from face to feet.',
    aliases: ['body scan', 'relax my body', 'progressive relaxation', 'tension'],
    theme: 'body scan relaxation',
    opening: 'I will guide a soft body scan. You do not need to do it perfectly.',
    instructions:
      'Guide a progressive muscle relaxation/body scan. Move slowly from face to jaw to chest to belly to hands to legs. Invite awareness, not force. If the user reports discomfort, slow down and ground.',
    segments: [
      { id: 'face', title: 'Face and jaw', prompt: 'Soften the forehead. Unclench the jaw. Let the tongue rest.', durationSec: 45, pace: 'slow' },
      { id: 'chest', title: 'Chest and breath', prompt: 'Notice the chest. Let the breath be easy rather than deep.', durationSec: 55, pace: 'slow' },
      { id: 'hands', title: 'Hands', prompt: 'Feel the hands from the inside. Warm, cool, tingling, or neutral is all okay.', durationSec: 45, pace: 'slow' },
      { id: 'legs', title: 'Legs and feet', prompt: 'Let the legs be held by the ground. Feel the feet heavy and safe.', durationSec: 60, pace: 'slow' },
    ],
  },
  {
    id: 'guided_self_hypnosis',
    kind: 'self_hypnosis',
    label: 'Safe self-hypnosis',
    description: 'Ethical positive suggestion with user-chosen goal.',
    aliases: ['hypnosis', 'self hypnosis', 'subconscious', 'affirmation', 'reprogramming'],
    theme: 'safe self hypnosis',
    safety:
      'Only use positive, consent-based suggestions. Do not claim control over the user. Avoid medical promises. Invite the user to stay aware and able to stop at any time.',
    opening: 'We can do safe self-hypnosis. Tell me the positive goal you want to support, or say start with calm confidence.',
    instructions:
      'Run a safe, ethical self-hypnosis session. First ask for the user’s chosen positive goal if unknown. Use permissive language: you may, you can, if it feels right. Keep the user in control and able to end any time.',
    segments: [
      { id: 'goal', title: 'Choose goal', prompt: 'What positive goal should this session support?', waitForUser: true, pace: 'slow' },
      { id: 'induction', title: 'Induction', prompt: 'Let your eyes soften. Count down from five, and with each number, release a little effort.', durationSec: 90, pace: 'whisper' },
      { id: 'suggestion', title: 'Suggestion', prompt: 'Repeat the chosen goal as a gentle possibility, never a command.', durationSec: 90, pace: 'whisper' },
      { id: 'return', title: 'Return', prompt: 'Come back slowly. Bring the useful part with you.', durationSec: 35, pace: 'slow' },
    ],
  },
  {
    id: 'guided_conflict_navigation',
    kind: 'conflict_navigation',
    label: 'Conflict navigation',
    description: 'A structured emotional processing flow.',
    aliases: ['conflict', 'argument', 'relationship', 'emotional processing', 'help me understand'],
    theme: 'conflict resolution',
    opening: 'I can help you untangle this gently. Start with one sentence: what happened?',
    instructions:
      'Guide conflict navigation using active listening, parts language, perspective taking, and needs. Do not judge or diagnose. Reflect feelings and needs, then offer numbered next steps. Ask one question at a time.',
    segments: [
      { id: 'story', title: 'What happened', prompt: 'Tell me the simplest version of what happened.', waitForUser: true },
      { id: 'feeling', title: 'Feeling', prompt: 'What feeling is strongest right now?', waitForUser: true },
      { id: 'need', title: 'Need', prompt: 'What part of you needs to be heard or protected?', waitForUser: true },
      { id: 'options', title: 'Choices', prompt: 'Offer three choices: soothe first, understand their perspective, or plan what to say.', waitForUser: true },
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
      segment.durationSec ? `${segment.durationSec}s` : null,
      segment.waitForUser ? 'wait for user' : null,
      segment.pace ? `pace=${segment.pace}` : null,
    ].filter(Boolean).join(', ');
    return `${index + 1}. ${segment.title}${flags ? ` (${flags})` : ''}: ${segment.prompt}`;
  }).join('\n');

  return [
    `Guided session: ${preset.label}.`,
    preset.description,
    preset.safety ? `Safety: ${preset.safety}` : '',
    preset.instructions,
    'Run the session as a stateful voice experience. Do not dump the whole script at once. Speak one segment, then wait when a segment says wait for user.',
    'The user may say pause, resume, deeper, skip, repeat, or end session. Use guided_session_control for these controls when appropriate.',
    `Script:\n${script}`,
  ].filter(Boolean).join('\n');
}

export function guidedSessionOpening(preset: GuidedSessionPreset) {
  return preset.opening || `Starting ${preset.label}.`;
}
