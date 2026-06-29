export type RouteDecision =
  | { kind: 'direct_tool'; tool: 'get_time' | 'get_weather' | 'play_youtube' | 'media_control' | 'show_settings_menu' | 'stop'; args: Record<string, unknown>; reason: string }
  | { kind: 'guided_session'; session: string; goal?: string; reason: string }
  | { kind: 'live_agent'; text: string; reason: string }
  | { kind: 'short_gpt'; text: string; reason: string }
  | { kind: 'ignore'; reason: string };

export type ForcedRoute = 'auto' | 'direct_tool' | 'short_gpt' | 'live_agent' | 'guided_session';

function cleanText(text: unknown) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function removeYoutubeWords(text: string) {
  return cleanText(text
    .replace(/\b(open|play|show|search|pull up|start)\b/gi, ' ')
    .replace(/\b(on|in|from)\s+youtube\b/gi, ' ')
    .replace(/\byoutube\b/gi, ' ')
    .replace(/\bvideo\b/gi, ' '));
}

function isExplicitLive(clean: string) {
  return /\b(start|enter|open|switch to|begin)\b.*\b(live|conversation|convo|talk mode|duplex)\b/.test(clean)
    || /\b(let'?s talk|stay with me|conversation mode|live mode|talk with me)\b/.test(clean);
}

function isGuided(clean: string) {
  return /\b(meditation|meditate|breathing|breathe|hypnosis|self hypnosis|body scan|conflict|ground me|calm me|bedtime|sleep)\b/.test(clean);
}

function guidedKind(clean: string) {
  if (/\b(hypnosis|self hypnosis|subconscious)\b/.test(clean)) return 'self_hypnosis';
  if (/\b(conflict|argument|fight|relationship)\b/.test(clean)) return 'conflict_navigation';
  if (/\b(body scan|relax my body)\b/.test(clean)) return 'body_scan';
  if (/\b(bedtime|sleep)\b/.test(clean)) return 'bedtime';
  return 'breathing';
}

export function decideVoiceRoute(input: unknown, options: { forceRoute?: ForcedRoute; allowAutoLive?: boolean } = {}): RouteDecision {
  const text = cleanText(input);
  const lower = text.toLowerCase();
  const forceRoute = options.forceRoute ?? 'auto';

  if (!text) return { kind: 'ignore', reason: 'empty_text' };

  if (forceRoute === 'live_agent') return { kind: 'live_agent', text, reason: 'forced_by_lab' };
  if (forceRoute === 'short_gpt') return { kind: 'short_gpt', text, reason: 'forced_by_lab' };
  if (forceRoute === 'guided_session') return { kind: 'guided_session', session: guidedKind(lower), goal: text, reason: 'forced_by_lab' };

  const stopMatch = /\b(stop|quiet|cancel|abort|shush|hush)\b/.test(lower);
  if (stopMatch) return { kind: 'direct_tool', tool: 'stop', args: {}, reason: 'safety_stop_or_cancel' };

  if (/\b(pause|hold)\b/.test(lower)) return { kind: 'direct_tool', tool: 'media_control', args: { command: 'pause' }, reason: 'direct_media_control' };
  if (/\b(resume|continue)\b/.test(lower)) return { kind: 'direct_tool', tool: 'media_control', args: { command: 'resume' }, reason: 'direct_media_control' };

  const youtubeIntent = /\b(youtube|video)\b/.test(lower) && /\b(open|play|show|search|pull up|start)\b/.test(lower);
  if (youtubeIntent || (forceRoute === 'direct_tool' && /\b(youtube|video|music|song|sound)\b/.test(lower))) {
    return {
      kind: 'direct_tool',
      tool: 'play_youtube',
      args: { query: removeYoutubeWords(text) || text, forceYouTube: true },
      reason: 'explicit_youtube_request',
    };
  }

  if (/\b(what time|time is it|current time|tell me the time)\b/.test(lower)) {
    return { kind: 'direct_tool', tool: 'get_time', args: { format: 'spoken' }, reason: 'direct_time_request' };
  }

  if (/\b(weather|temperature|rain|forecast)\b/.test(lower)) {
    return { kind: 'direct_tool', tool: 'get_weather', args: {}, reason: 'direct_weather_request' };
  }

  if (/\b(settings|menu|options)\b/.test(lower) && /\b(open|show|change|voice|listening|sensitivity)?\b/.test(lower)) {
    return { kind: 'direct_tool', tool: 'show_settings_menu', args: { category: 'main' }, reason: 'direct_settings_request' };
  }

  if (isExplicitLive(lower)) return { kind: 'live_agent', text, reason: 'explicit_user_requested_live_agent' };
  if (isGuided(lower)) return { kind: 'guided_session', session: guidedKind(lower), goal: text, reason: 'guided_skill_request' };

  if (options.allowAutoLive && /\b(help me understand|can we explore|i feel|i am feeling|relationship|life decision|clarify with me)\b/.test(lower)) {
    return { kind: 'live_agent', text, reason: 'auto_live_allowed_complex_back_and_forth' };
  }

  if (forceRoute === 'direct_tool') {
    return { kind: 'short_gpt', text, reason: 'forced_direct_tool_but_no_direct_tool_matched' };
  }

  return { kind: 'short_gpt', text, reason: 'default_short_reasoning' };
}
