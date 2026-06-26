export type LiveEscalation = 'short_tts' | 'live_audio' | 'deterministic_session';

function env(name: string) {
  return process.env?.[name] ?? '';
}

function maxShortChars() {
  const n = Number(env('EXPO_PUBLIC_AGA_SHORT_REPLY_MAX_CHARS') || 260);
  return Number.isFinite(n) && n > 80 ? n : 260;
}

const LIVE_PATTERNS = [
  /\b(talk|conversation|discuss|explain|coach|therapy|conflict|help me think|what should i do)\b/i,
  /\b(translate|practice|language|role play|brainstorm|research|weather|current|latest|news)\b/i,
  /\b(open mic|hands free|duplex|live session|keep listening)\b/i,
];

const DETERMINISTIC_PATTERNS = [
  /\b(box breathing|breathe|breathing|meditation|self hypnosis|hypnosis|sleep|wind down|body scan)\b/i,
];

export function classifyTurnForVoicePath(text: string): LiveEscalation {
  const clean = String(text || '').trim();
  if (!clean) return env('EXPO_PUBLIC_AGA_LIVE_AFTER_WAKE') === '1' ? 'live_audio' : 'short_tts';
  if (DETERMINISTIC_PATTERNS.some((re) => re.test(clean))) return 'deterministic_session';
  if (LIVE_PATTERNS.some((re) => re.test(clean))) return 'live_audio';
  if (clean.length > maxShortChars()) return 'live_audio';
  return 'short_tts';
}

export function shouldAnswerWithShortTts(text: string) {
  return classifyTurnForVoicePath(text) === 'short_tts';
}
