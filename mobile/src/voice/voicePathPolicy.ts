export type VoicePathDecision =
  | { path: 'local_control'; reason: string }
  | { path: 'deterministic_guided'; reason: string }
  | { path: 'short_stt_gpt5_tools_tts'; reason: string }
  | { path: 'live_session'; reason: string };

function env(name: string) {
  return process.env?.[name] ?? '';
}

const LOCAL_CONTROL_PATTERNS = [
  /\b(stop|quiet|cancel|shush|hush|pause|resume|continue|repeat options|close menu|back)\b/i,
  /\b(berhenti|jeda|lanjut|ulang|tutup|kembali)\b/i,
  /\b(стоп|пауза|продолжить|повтори|закрыть|назад)\b/i,
];

const DETERMINISTIC_GUIDED_PATTERNS = [
  /\b(box breathing|breathe|breathing exercise|meditation|self hypnosis|hypnosis|sleep|wind down|body scan)\b/i,
  /\b(conflict resolution|resolve a conflict|calm me down|ground me)\b/i,
];

const DIRECT_TOOL_PATTERNS = [
  /\b(play|open|show|search|pull up)\b.*\b(youtube|video|music|song|ambient)\b/i,
  /\b(change|switch|choose|set|open|show)\b.*\b(voice|settings|personality|persona|language|listening|sensitivity)\b/i,
  /\b(remind me|set a reminder|remember this|forget everything|start over|new session)\b/i,
];

const GENERATIVE_SHORT_PATTERNS = [
  /\b(tell me|make up|generate|write|create)\b.*\b(story|poem|lullaby|script|affirmation|hypnosis script)\b/i,
  /\b(story time|bedtime story)\b/i,
];

const EXPLICIT_LIVE_PATTERNS = [
  /\b(live session|live mode|open mic|hands free|hands-free|duplex|stay with me|keep listening|conversation mode)\b/i,
  /\b(lets? practice|practice english|language tutor|role play with me|talk with me continuously)\b/i,
  /\b(interactive guided|guide me interactively|continuous conversation)\b/i,
];

function livePolicy() {
  return String(env('EXPO_PUBLIC_AGA_LIVE_SESSION_POLICY') || 'casual_by_default').toLowerCase();
}

export function decideVoicePath(text: string): VoicePathDecision {
  const clean = String(text || '').trim();
  if (!clean) return { path: 'short_stt_gpt5_tools_tts', reason: 'empty_or_transcribed_audio' };
  if (LOCAL_CONTROL_PATTERNS.some((re) => re.test(clean))) return { path: 'local_control', reason: 'local_control_phrase' };
  if (DETERMINISTIC_GUIDED_PATTERNS.some((re) => re.test(clean))) return { path: 'deterministic_guided', reason: 'deterministic_guided_phrase' };
  if (DIRECT_TOOL_PATTERNS.some((re) => re.test(clean))) return { path: 'short_stt_gpt5_tools_tts', reason: 'direct_tool_or_setting_request' };
  if (GENERATIVE_SHORT_PATTERNS.some((re) => re.test(clean))) return { path: 'short_stt_gpt5_tools_tts', reason: 'generate_then_tts' };
  if (livePolicy() !== 'never' && EXPLICIT_LIVE_PATTERNS.some((re) => re.test(clean))) return { path: 'live_session', reason: 'explicit_live_phrase' };
  if (livePolicy() === 'always' || livePolicy() === 'casual_by_default' || livePolicy() === 'most_requests') {
    return { path: 'live_session', reason: 'casual_default_live_session' };
  }
  return { path: 'short_stt_gpt5_tools_tts', reason: 'default_short_reasoning_path' };
}

export function isExplicitLiveRequest(text: string) {
  return decideVoicePath(text).path === 'live_session';
}
