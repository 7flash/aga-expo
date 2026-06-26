export type VoicePath = 'short_reasoning' | 'live_audio' | 'deterministic_session';

function env(name: string) {
  return process.env?.[name] ?? '';
}

const DETERMINISTIC_PATTERNS = [
  /\b(box breathing|breathe|breathing|meditation|self hypnosis|hypnosis|sleep|wind down|body scan)\b/i,
];

const EXPLICIT_LIVE_PATTERNS = [
  /\b(live session|live mode|open mic|hands free|hands-free|duplex|stay with me|keep listening|conversation mode)\b/i,
  /\b(lets? practice|practice english|language tutor|role play with me|talk with me)\b/i,
  /\b(interactive guided|guide me interactively|continuous conversation)\b/i,
];

export function classifyTurnForVoicePath(text: string): VoicePath {
  const clean = String(text || '').trim();
  if (!clean) return 'short_reasoning';
  if (DETERMINISTIC_PATTERNS.some((re) => re.test(clean))) return 'deterministic_session';
  const policy = String(env('EXPO_PUBLIC_AGA_LIVE_SESSION_POLICY') || 'explicit_only').toLowerCase();
  if (policy !== 'never' && EXPLICIT_LIVE_PATTERNS.some((re) => re.test(clean))) return 'live_audio';
  return 'short_reasoning';
}

export function shouldOpenLiveSessionExplicitly(text: string) {
  return classifyTurnForVoicePath(text) === 'live_audio';
}

export function shouldAnswerWithShortTts(text: string) {
  return classifyTurnForVoicePath(text) === 'short_reasoning';
}
