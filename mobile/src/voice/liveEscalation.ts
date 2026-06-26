import { decideVoicePath } from './voicePathPolicy';

export type VoicePath = 'short_reasoning' | 'live_audio' | 'deterministic_session' | 'local_control';

export function classifyTurnForVoicePath(text: string): VoicePath {
  const decision = decideVoicePath(text);
  if (decision.path === 'live_session') return 'live_audio';
  if (decision.path === 'deterministic_guided') return 'deterministic_session';
  if (decision.path === 'local_control') return 'local_control';
  return 'short_reasoning';
}

export function shouldOpenLiveSessionExplicitly(text: string) {
  return classifyTurnForVoicePath(text) === 'live_audio';
}

export function shouldAnswerWithShortTts(text: string) {
  return classifyTurnForVoicePath(text) === 'short_reasoning';
}
