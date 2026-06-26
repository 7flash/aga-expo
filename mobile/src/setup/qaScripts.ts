export type QaStep = {
  id: string;
  command: string;
  expected: string;
  phase: 'voice' | 'memory' | 'media' | 'translation' | 'routines' | 'recovery' | 'production' | 'wake' | 'guided';
};

export const VOICE_ONLY_QA_STEPS: QaStep[] = [
  { id: 'porcupine-aga', phase: 'wake', command: 'AGA', expected: 'Porcupine detects keyword index 0 and opens post-wake live ear or says the short acknowledgement.' },
  { id: 'porcupine-stop', phase: 'wake', command: 'stop', expected: 'Porcupine detects keyword index 1; all speech/media/guided playback stops without cloud STT.' },
  { id: 'porcupine-pause', phase: 'wake', command: 'pause', expected: 'Porcupine detects keyword index 2; active media or guided session pauses without cloud STT.' },
  { id: 'short-status', phase: 'voice', command: 'AGA status', expected: 'AGA responds through ElevenLabs/OpenAI TTS, not Android system TTS.' },
  { id: 'guided-breathing', phase: 'guided', command: 'AGA start box breathing', expected: 'Deterministic guided runner starts local timed segments with expressive TTS.' },
  { id: 'guided-hypnosis', phase: 'guided', command: 'AGA self hypnosis for confidence', expected: 'Local phase machine runs safety, induction, deepening, suggestion, emergence, and grounding.' },
  { id: 'live-escalation', phase: 'voice', command: 'AGA help me resolve a conflict with my friend', expected: 'Route escalates to Gemini/OpenAI live session because it needs conversation.' },
  { id: 'memory-rag', phase: 'memory', command: 'AGA I feel tense again', expected: 'Subconscious recall fetches relevant memory before live/coaching response.' },
  { id: 'media-stop', phase: 'media', command: 'stop', expected: 'Keyword stop kills media without waiting for STT finalization.' },
  { id: 'recovery', phase: 'recovery', command: 'AGA repair yourself', expected: 'Diagnostics include Porcupine, expressive TTS, and selected live engine.' },
];

export function qaScriptSpeech() {
  return VOICE_ONLY_QA_STEPS.map((step, index) => `${index + 1}. ${step.command}: ${step.expected}`).join(' ');
}
