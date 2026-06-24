export type AssistantIntent =
  | 'chat'
  | 'play_music'
  | 'play_youtube'
  | 'media_control'
  | 'translate'
  | 'persona'
  | 'agent'
  | 'system'
  | 'settings'
  | 'unknown';

export type AgaAction =
  | { type: 'youtube.play'; query: string }
  | { type: 'youtube.control'; command: 'pause' | 'resume' | 'stop' | 'next' | 'volume'; value?: number }
  | { type: 'music.play'; query: string }
  | { type: 'music.control'; command: 'pause' | 'resume' | 'stop' | 'volume'; value?: number }
  | { type: 'persona.set'; persona: string }
  | { type: 'translate.start'; from?: string; to: string }
  | { type: 'translate.stop' }
  | { type: 'agent.spawn'; goal: string }
  | { type: 'memory.save'; text: string }
  | { type: 'system.health' }
  | { type: 'system.help' }
  | { type: 'conversation.reset' }
  | { type: 'diagnostics.show' }
  | { type: 'diagnostics.hide' }
  | { type: 'voice.rate'; value: number }
  | { type: 'voice.pitch'; value: number }
  | { type: 'wake.set'; phrase: string }
  | { type: 'media.status' };

export type AgaTurn = {
  speech: string;
  actions: AgaAction[];
  intent: AssistantIntent;
};

const LANGUAGE_WORDS: Record<string, string> = {
  indonesian: 'id',
  indonesia: 'id',
  russian: 'ru',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  japanese: 'ja',
  chinese: 'zh',
  english: 'en',
};

export function inferLocalActions(text: string): AgaTurn | null {
  const clean = text.trim();
  const lower = clean.toLowerCase();

  if (!clean) return null;


  if (/\b(show|open)\s+(debug|diagnostics|logs|metrics)\b/.test(lower)) {
    return { speech: 'Diagnostics are on screen.', actions: [{ type: 'diagnostics.show' }], intent: 'system' };
  }

  if (/\b(hide|close)\s+(debug|diagnostics|logs|metrics)\b/.test(lower)) {
    return { speech: 'Diagnostics are hidden.', actions: [{ type: 'diagnostics.hide' }], intent: 'system' };
  }

  const wakePhraseMatch = clean.match(/(?:change|set)\s+(?:your\s+)?wake\s+(?:word|phrase)\s+(?:to\s+)?(.+)/i);
  if (wakePhraseMatch) {
    const phrase = wakePhraseMatch[1].replace(/[.!?]+$/g, '').trim().toLowerCase();
    if (phrase.length >= 3 && phrase.length <= 32) {
      return { speech: `Okay. My wake phrase is now ${phrase}.`, actions: [{ type: 'wake.set', phrase }], intent: 'settings' };
    }
  }

  if (/\b(what'?s playing|what is playing|now playing)\b/.test(lower)) {
    return { speech: 'I will check what is playing.', actions: [{ type: 'media.status' }], intent: 'media_control' };
  }

  if (/\b(speak|talk)\s+(slower|more slowly)\b/.test(lower)) {
    return { speech: 'I will speak more slowly.', actions: [{ type: 'voice.rate', value: 0.9 }], intent: 'settings' };
  }

  if (/\b(speak|talk)\s+(faster|quicker)\b/.test(lower)) {
    return { speech: 'I will speak faster.', actions: [{ type: 'voice.rate', value: 1.12 }], intent: 'settings' };
  }

  if (/\b(speak|talk)\s+(normally|normal speed)\b/.test(lower)) {
    return { speech: 'Back to normal speaking speed.', actions: [{ type: 'voice.rate', value: 1 }], intent: 'settings' };
  }

  if (/\b(reset|new conversation|clear conversation)\b/.test(lower)) {
    return { speech: 'Fresh conversation started.', actions: [{ type: 'conversation.reset' }], intent: 'system' };
  }

  if (/\b(health|diagnostics|status report)\b/.test(lower)) {
    return { speech: 'Running my local health check.', actions: [{ type: 'system.health' }], intent: 'system' };
  }

  if (/\b(help|what can i say|commands)\b/.test(lower)) {
    return {
      speech: 'You can ask me to chat, play YouTube, play music, pause, resume, change my voice, or translate.',
      actions: [{ type: 'system.help' }],
      intent: 'system',
    };
  }

  if (/\b(stop translating|end translation|translation off)\b/.test(lower)) {
    return { speech: 'Translation mode is off.', actions: [{ type: 'translate.stop' }], intent: 'translate' };
  }

  const translateMatch = lower.match(/\b(?:translate|live translate).*\b(?:to|into)\s+([a-zA-Z]+)/);
  if (translateMatch) {
    const to = LANGUAGE_WORDS[translateMatch[1]] ?? translateMatch[1];
    return { speech: `Translation mode is on. I will translate to ${translateMatch[1]}.`, actions: [{ type: 'translate.start', to }], intent: 'translate' };
  }

  const personaMatch = lower.match(/\b(?:use|switch to|be|become)\s+(warm|bright|calm|coach|story|playful|wise|supportive|energetic)\b/);
  if (personaMatch) {
    const raw = personaMatch[1];
    const persona = raw === 'supportive' ? 'warm' : raw === 'wise' ? 'calm' : raw === 'playful' ? 'bright' : raw === 'energetic' ? 'coach' : raw;
    return { speech: `Okay, I will use my ${persona} voice.`, actions: [{ type: 'persona.set', persona }], intent: 'persona' };
  }


  const volumeMatch = lower.match(/\b(?:volume|set volume)\s+(?:to\s+)?(\d{1,3})\b/);
  if (volumeMatch) {
    const value = Math.max(0, Math.min(100, Number(volumeMatch[1])));
    return { speech: `Volume ${value} percent.`, actions: [{ type: 'youtube.control', command: 'volume', value }, { type: 'music.control', command: 'volume', value }], intent: 'media_control' };
  }

  if (/\b(volume up|louder)\b/.test(lower)) {
    return { speech: 'Turning it up.', actions: [{ type: 'youtube.control', command: 'volume', value: 75 }, { type: 'music.control', command: 'volume', value: 75 }], intent: 'media_control' };
  }

  if (/\b(volume down|quieter|softer)\b/.test(lower)) {
    return { speech: 'Turning it down.', actions: [{ type: 'youtube.control', command: 'volume', value: 35 }, { type: 'music.control', command: 'volume', value: 35 }], intent: 'media_control' };
  }

  if (/\b(pause|hold on)\b/.test(lower)) {
    return { speech: 'Paused.', actions: [{ type: 'youtube.control', command: 'pause' }, { type: 'music.control', command: 'pause' }], intent: 'media_control' };
  }

  if (/\b(resume|continue|keep playing)\b/.test(lower)) {
    return { speech: 'Continuing.', actions: [{ type: 'youtube.control', command: 'resume' }, { type: 'music.control', command: 'resume' }], intent: 'media_control' };
  }

  if (/\b(stop|quiet|silence)\b/.test(lower)) {
    return { speech: 'Stopping playback.', actions: [{ type: 'youtube.control', command: 'stop' }, { type: 'music.control', command: 'stop' }], intent: 'media_control' };
  }

  const youtubeMatch = clean.match(/(?:play|open|show)\s+(.+?)\s+(?:on\s+)?youtube/i) ?? clean.match(/youtube\s+(.+)/i);
  if (youtubeMatch) {
    const query = youtubeMatch[1].trim();
    return { speech: `Opening ${query} on YouTube.`, actions: [{ type: 'youtube.play', query }], intent: 'play_youtube' };
  }

  const musicMatch = clean.match(/(?:play|put on)\s+(.+?)(?:\s+music)?$/i);
  if (musicMatch && /\b(song|music|track|playlist|lofi|lo-fi|calm|chill|beats|artist|album|play)\b/.test(lower)) {
    const query = musicMatch[1].replace(/\bmusic\b/gi, '').trim();
    if (query.length > 1) {
      return { speech: `Playing ${query}.`, actions: [{ type: 'music.play', query }], intent: 'play_music' };
    }
  }

  return null;
}

export function sanitizeTurn(input: unknown): AgaTurn | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Partial<AgaTurn>;
  if (typeof value.speech !== 'string') return null;
  const actions = Array.isArray(value.actions) ? value.actions.filter(Boolean) as AgaAction[] : [];
  const intent = typeof value.intent === 'string' ? value.intent as AssistantIntent : 'chat';
  return { speech: value.speech.trim() || 'I heard you.', actions, intent };
}
