import { stripWakePrefix } from './text';

export type LocalControlIntent = { tool: string; args?: Record<string, unknown>; userVisible?: boolean } | null;

function normalizeControlText(text: string) {
  return String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ');
}

function has(text: string, alternatives: string) {
  return new RegExp(`\\b(?:${alternatives})\\b`, 'i').test(text);
}

function detectLanguageRequest(text: string): { locale: string; label: string } | null {
  const clean = normalizeControlText(text);
  if (/\b(stop|quit|disable)\s+(russian|indonesian|spanish|translation|translate)\b/.test(clean)) return { locale: 'en-US', label: 'English' };
  if (/\b(speak|use|switch to|change language to|talk in|answer in)\s+english\b|\bin english(?: please)?\b/.test(clean)) return { locale: 'en-US', label: 'English' };
  if (/\b(speak|use|switch to|change language to|talk in|answer in)\s+russian\b/.test(clean)) return { locale: 'ru-RU', label: 'Russian' };
  if (/\b(speak|use|switch to|change language to|talk in|answer in)\s+indonesian\b/.test(clean)) return { locale: 'id-ID', label: 'Indonesian' };
  if (/\b(speak|use|switch to|change language to|talk in|answer in)\s+spanish\b/.test(clean)) return { locale: 'es-ES', label: 'Spanish' };
  return null;
}

export function localControlIntent(text: string): LocalControlIntent {
  const clean = normalizeControlText(stripWakePrefix(text) || text);
  if (!clean) return null;

  if (/\b(yes\s+forget\s+everything|confirm\s+forget\s+everything)\b/.test(clean)) {
    return { tool: 'forget_user_data', args: { scope: 'everything', confirmation: 'yes forget everything' } };
  }
  if (/\b(forget\s+everything|wipe\s+everything|reset\s+all\s+personal)\b/.test(clean)) {
    return { tool: 'forget_user_data', args: { scope: 'everything' } };
  }
  if (/\b(start\s+over|new\s+session|fresh\s+session|reset\s+context|clear\s+context|clean\s+slate)\b/.test(clean)) {
    return { tool: 'start_new_conversation_session', args: { reason: 'local_voice_command', endActiveSkill: true } };
  }

  const language = detectLanguageRequest(clean);
  if (language) return { tool: 'set_ui_language', args: { locale: language.locale, label: language.label } };

  if (has(clean, 'gemini|cost|budget|usage|spent|spend|cheap mode|daily limit') && has(clean, 'status|how much|usage|cost|budget|spent|left|remaining|limit')) {
    return { tool: 'gemini_cost_status', args: {} };
  }

  if (/\b(make that|yes make it|accept|enable)\b.*\b(routine|habit)\b|\bmake that a routine\b/.test(clean)) {
    return { tool: 'accept_learned_routine', args: {} };
  }
  if (/\b(ignore|dismiss|forget)\b.*\b(routine|habit|pattern)\b/.test(clean)) {
    return { tool: 'dismiss_learned_routine', args: {} };
  }
  if (/\b(what have you noticed|noticed about me|stress patterns|patterns about me|my habits)\b/.test(clean)) {
    return { tool: 'summarize_learned_patterns', args: {} };
  }
  if (/\b(teach|learn|remember)\b.*\bwhen i say\b/.test(clean) || /\bwhen i say\b.+\b(do|start|run|play|say)\b/.test(clean)) {
    return { tool: 'learn_user_scenario', args: { text: clean } };
  }
  if (/\b(soundscape companion|companion soundscape|background companion|keep gentle sound)\b/.test(clean)) {
    return { tool: 'soundscape_companion', args: { query: clean, useCase: 'conversation' } };
  }
  if (/\b(evening wind[- ]?down|build a habit|new routine|daily routine|night routine)\b/.test(clean)) {
    return { tool: 'propose_learned_routine', args: { title: 'Voice-taught routine', prompt: clean, timeOfDay: clean.includes('evening') || clean.includes('night') ? '22:00' : 'any', confidence: 0.72 } };
  }
  if (/\b(change|switch|choose|set|open|show)\b.*\bvoice\b|\bvoice\s+(menu|settings|options)\b/.test(clean)) {
    return { tool: 'show_settings_menu', args: { category: 'voice' } };
  }
  if (/\b(change|switch|choose|set|open|show)\b.*\b(personality|persona)\b|\bpersonality\s+(menu|settings|options)\b/.test(clean)) {
    return { tool: 'show_settings_menu', args: { category: 'personality' } };
  }
  if (/\b(change|set|open|show)\b.*\b(listening|sensitivity|interruptions?)\b|\b(stop\s+interrupting|be\s+less\s+sensitive|listen\s+hands\s*free)\b/.test(clean)) {
    return { tool: 'show_settings_menu', args: { category: 'listening' } };
  }
  if (/\b(choose|open|show|start|pick)\b.*\b(skill|skills|session|sessions)\b|\bskills\s+menu\b/.test(clean)) {
    return { tool: 'show_settings_menu', args: { category: 'skills' } };
  }
  if (/\b(open|show)\b.*\b(menu|settings|options)\b|^menu$|^settings$|^options$/.test(clean)) {
    return { tool: 'show_settings_menu', args: { category: 'main' } };
  }

  if (has(clean, 'louder|volume up|turn it up|raise volume|more volume')) {
    return { tool: 'media_control', args: { command: 'volume_up' } };
  }
  if (has(clean, 'softer|quieter|volume down|turn it down|lower volume|less volume')) {
    return { tool: 'media_control', args: { command: 'volume_down' } };
  }
  if (has(clean, 'mute|silent')) {
    return { tool: 'media_control', args: { command: 'mute' } };
  }
  if (has(clean, 'unmute')) {
    return { tool: 'media_control', args: { command: 'unmute' } };
  }
  if (/\b(change|another|different|next|skip)\b.*\b(video|youtube|music|song|track)?\b/.test(clean)) {
    return { tool: 'play_youtube', args: { query: clean || 'different calm ambient music', forceYouTube: /youtube|video/.test(clean) } };
  }

  if (/\b(close|stop|dismiss)\b.*\b(video|youtube|music|song|player|ambient)\b/.test(clean) || /^stop music$/.test(clean)) {
    return { tool: 'media_control', args: { command: 'stop' } };
  }
  if (/\b(pause|hold)\b(?:.*\b(video|youtube|music|song|player|ambient)\b)?/.test(clean)) {
    return { tool: 'media_control', args: { command: 'pause' } };
  }
  if (/\b(resume|continue)\b(?:.*\b(video|youtube|music|song|player|ambient)\b)?/.test(clean)) {
    return { tool: 'media_control', args: { command: 'resume' } };
  }
  if (/\b(play|put on|start|search)\b.*\b(music|youtube|song|ambient|lofi|lo-fi|calm|meditation music|relaxing|piano)\b|^music$|^calm music$/.test(clean)) {
    return { tool: 'play_youtube', args: { query: clean || 'calm music', forceYouTube: /youtube|youtu.be/.test(clean) } };
  }


  if (/\b(end|stop|finish)\b.*\b(session|meditation|hypnosis|breathing|guidance)\b/.test(clean) || /^end session$/.test(clean)) {
    return { tool: 'guided_session_control', args: { command: 'end' } };
  }
  if (/\b(pause|resume|repeat|skip|deeper|next)\b.*\b(session|meditation|hypnosis|breathing|guidance)?\b/.test(clean)) {
    const command = /\bresume\b/.test(clean) ? 'resume' : /\brepeat\b/.test(clean) ? 'repeat' : /\bskip\b/.test(clean) ? 'skip' : /\bdeeper\b/.test(clean) ? 'deeper' : /\bnext\b/.test(clean) ? 'next' : 'pause';
    return { tool: 'guided_session_control', args: { command } };
  }

  if (/\bbody\s+scan\b/.test(clean)) return { tool: 'start_guided_session', args: { kind: 'body_scan', goal: 'body scan' } };
  if (/\b(hypnosis|self\s+hypnosis|hypnotic)\b/.test(clean)) return { tool: 'start_guided_session', args: { kind: 'self_hypnosis', goal: 'safe self-hypnosis' } };
  if (/\b(resolve|process|help)\b.*\b(conflict|argument|fight|tension)\b/.test(clean)) return { tool: 'start_guided_session', args: { kind: 'conflict_navigation', goal: clean } };
  if (/\b(meditation|meditate|breathing|breathwork|calm me|nervous system)\b/.test(clean)) return { tool: 'start_guided_session', args: { kind: 'breathing', goal: clean } };

  return null;
}
