import type { AgaMode } from './actions';

const BARGE_IN_RE = /\b(aga\s+)?(stop|quiet|cancel|shush|be quiet|wait|listen)\b/i;

export type SpeechGateDecision = {
  accept: boolean;
  reason: string;
  isBargeIn: boolean;
};

export function isBargeInCommand(text: string) {
  return BARGE_IN_RE.test(text.trim());
}

export function shouldAcceptFinalSpeech(mode: AgaMode, text: string, processing: boolean): SpeechGateDecision {
  const clean = text.trim();
  const isBargeIn = isBargeInCommand(clean);

  if (!clean) return { accept: false, reason: 'empty', isBargeIn };
  if (isBargeIn) return { accept: true, reason: 'barge_in', isBargeIn };
  if (processing) return { accept: false, reason: 'turn_busy', isBargeIn };

  switch (mode) {
    case 'sleeping':
    case 'listening':
    case 'translating':
      return { accept: true, reason: 'mode_accepts_speech', isBargeIn };
    case 'thinking':
    case 'speaking':
      return { accept: false, reason: `mode_${mode}_blocks_new_turn`, isBargeIn };
    default:
      return { accept: false, reason: `mode_${String(mode)}_blocked`, isBargeIn };
  }
}
