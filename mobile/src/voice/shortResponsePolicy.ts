export type ResponseRoute = 'silent_control' | 'short_tts' | 'live_session';

const LIVE_HINTS = [
  /\b(conversation|talk with me|discuss|explain|why|how do i|help me understand)\b/i,
  /\b(conflict|therapy|hypnosis|meditation|coach me|guide me)\b/i,
  /\b(real[ -]?time|current|latest|weather|news|search)\b/i,
];

const SHORT_TOOL_HINTS = [
  /\b(time|date|reminder|remember|stop|pause|resume|status|volume|weather)\b/i,
  /\b(play|music|soundscape|settings|diagnostics|wake phrase)\b/i,
];

export function chooseResponseRoute(text: string, liveMode = process.env.EXPO_PUBLIC_AGA_LIVE_ESCALATION || 'auto'): ResponseRoute {
  const clean = String(text || '').trim();
  if (!clean) return 'short_tts';
  if (/^(stop|pause|resume|cancel|quiet)$/i.test(clean)) return 'silent_control';
  if (liveMode === 'always') return 'live_session';
  if (liveMode === 'never') return 'short_tts';
  if (liveMode === 'manual') return /\b(live|conversation mode|deep talk)\b/i.test(clean) ? 'live_session' : 'short_tts';
  if (SHORT_TOOL_HINTS.some((rx) => rx.test(clean)) && clean.split(/\s+/).length <= 14) return 'short_tts';
  if (LIVE_HINTS.some((rx) => rx.test(clean))) return 'live_session';
  return clean.length > 120 ? 'live_session' : 'short_tts';
}

export function shouldOpenLiveSession(text: string) {
  return chooseResponseRoute(text) === 'live_session';
}