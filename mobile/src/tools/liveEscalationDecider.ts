import { chooseResponseRoute } from '../voice/shortResponsePolicy';

export type LiveEscalationDecision = {
  route: 'silent_control' | 'short_tts' | 'live_session';
  reason: string;
};

export function decideLiveEscalation(text: string): LiveEscalationDecision {
  const route = chooseResponseRoute(text);
  if (route === 'silent_control') return { route, reason: 'Immediate local control keyword; no spoken acknowledgement needed.' };
  if (route === 'short_tts') return { route, reason: 'Short tool/local response; use expressive TTS without opening live session.' };
  return { route, reason: 'OpenAI/Gemini live session is justified by conversational depth or realtime reasoning need.' };
}
