export type AssistantIntent =
  | 'chat'
  | 'play_music'
  | 'play_youtube'
  | 'media_control'
  | 'media_queue'
  | 'notifications'
  | 'favorite'
  | 'routine'
  | 'voice'
  | 'translate'
  | 'persona'
  | 'agent'
  | 'system'
  | 'settings'
  | 'memory'
  | 'reminder'
  | 'history'
  | 'backup'
  | 'recovery'
  | 'setup'
  | 'production'
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
  | { type: 'system.health' }
  | { type: 'system.help' }
  | { type: 'conversation.reset' }
  | { type: 'diagnostics.show' }
  | { type: 'diagnostics.hide' }
  | { type: 'voice.rate'; value: number }
  | { type: 'voice.pitch'; value: number }
  | { type: 'wake.set'; phrase: string }
  | { type: 'media.status' }
  | { type: 'media.next' }
  | { type: 'media.queue.add'; kind: 'youtube' | 'music'; query: string }
  | { type: 'media.queue.status' }
  | { type: 'media.queue.clear' }
  | { type: 'memory.save'; text: string }
  | { type: 'memory.recall'; query?: string }
  | { type: 'memory.clear' }
  | { type: 'reminder.create'; title: string; dueAt: string }
  | { type: 'reminder.list' }
  | { type: 'reminder.clear' }
  | { type: 'proactive.toggle'; enabled: boolean }
  | { type: 'notifications.toggle'; enabled: boolean }
  | { type: 'notifications.request' }
  | { type: 'command.harness' }
  | { type: 'history.search'; query: string }
  | { type: 'backup.export' }
  | { type: 'backup.summary' }
  | { type: 'diagnostics.clear_logs' }
  | { type: 'media.favorite.save' }
  | { type: 'media.favorite.list'; query?: string }
  | { type: 'media.favorite.clear' }
  | { type: 'translation.history' }
  | { type: 'translation.history.clear' }
  | { type: 'routine.create'; title: string; prompt: string; timeOfDay: string; daysOfWeek?: string | null }
  | { type: 'routine.list' }
  | { type: 'routine.clear' }
  | { type: 'routine.brief' }
  | { type: 'voice.diagnostics' }
  | { type: 'voice.watchdog'; enabled: boolean }
  | { type: 'backend.set'; mode: 'offline' | 'openai-direct' | 'gemini-direct' | 'tradjs-remote' }
  | { type: 'setup.complete' }
  | { type: 'setup.status' }
  | { type: 'setup.test_voice' }
  | { type: 'setup.test_notifications' }
  | { type: 'setup.test_brain' }
  | { type: 'production.qa_script'; suite?: 'build' | 'smoke' | 'voice' | 'media' | 'translation' | 'release' }
  | { type: 'production.dependency_summary' }
  | { type: 'production.build_commands' }
  | { type: 'production.release_checklist' }
  | { type: 'production.full_rc_script' }
  | { type: 'translation.repeat' }
  | { type: 'translation.slower' }
  | { type: 'system.self_repair' }
  | { type: 'system.factory_reset_request' }
  | { type: 'system.factory_reset_confirm' };

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


  if (/\b(complete setup|finish setup|i am ready)\b/.test(lower)) {
    return { speech: 'Setup is complete. I will stay in voice-first mode.', actions: [{ type: 'setup.complete' }], intent: 'settings' };
  }


  if (/\b(setup status|first run status|readiness|am i ready|production status)\b/.test(lower)) {
    return { speech: 'I will check whether this APK is ready for voice-only use.', actions: [{ type: 'setup.status' }], intent: 'setup' };
  }

  if (/\b(test my voice|test voice|test microphone|voice test)\b/.test(lower)) {
    return { speech: 'Testing voice input and speech output.', actions: [{ type: 'setup.test_voice' }], intent: 'setup' };
  }

  if (/\b(test notifications|notification test)\b/.test(lower)) {
    return { speech: 'Testing local notifications.', actions: [{ type: 'setup.test_notifications' }], intent: 'setup' };
  }

  if (/\b(test brain|brain test|check brain connection|test cloud brain)\b/.test(lower)) {
    return { speech: 'Testing my current brain mode.', actions: [{ type: 'setup.test_brain' }], intent: 'setup' };
  }

  if (/\b(show|run|open)\s+(the\s+)?(qa|test)\s+script\b/.test(lower) || /\bvoice-only qa\b/.test(lower)) {
    return { speech: 'I will show the voice-only QA script.', actions: [{ type: 'production.qa_script' }], intent: 'production' };
  }

  if (/\b(dependency summary|build commands|what do i install|apk dependencies)\b/.test(lower)) {
    return { speech: 'I will summarize the APK dependencies.', actions: [{ type: 'production.dependency_summary' }], intent: 'production' };
  }

  if (/\b(build checklist|build stabilization|compile checklist|run android checklist)\b/.test(lower)) {
    return { speech: 'I will show the build stabilization checklist.', actions: [{ type: 'production.qa_script', suite: 'build' }, { type: 'production.build_commands' }], intent: 'production' };
  }

  if (/\b(smoke test|apk smoke test|run smoke)\b/.test(lower)) {
    return { speech: 'I will show the APK smoke test.', actions: [{ type: 'production.qa_script', suite: 'smoke' }], intent: 'production' };
  }

  if (/\b(voice soak|soak test|30 minute test|voice reliability test)\b/.test(lower)) {
    return { speech: 'I will show the voice soak test.', actions: [{ type: 'production.qa_script', suite: 'voice' }], intent: 'production' };
  }

  if (/\b(media reliability|media test|youtube test|music test)\b/.test(lower)) {
    return { speech: 'I will show the media reliability test.', actions: [{ type: 'production.qa_script', suite: 'media' }], intent: 'production' };
  }

  if (/\b(translation memory test|translation test|memory polish test)\b/.test(lower)) {
    return { speech: 'I will show the translation and memory test.', actions: [{ type: 'production.qa_script', suite: 'translation' }], intent: 'production' };
  }

  if (/\b(full rc script|full release script|run full qa|all qa)\b/.test(lower)) {
    return { speech: 'I will show the full release-candidate script.', actions: [{ type: 'production.full_rc_script' }], intent: 'production' };
  }

  if (/\b(release checklist|release candidate checklist|rc checklist|prepare rc1)\b/.test(lower)) {
    return { speech: 'I will read the release candidate checklist.', actions: [{ type: 'production.release_checklist' }], intent: 'production' };
  }

  if (/\b(voice diagnostics|microphone diagnostics|speech diagnostics)\b/.test(lower)) {
    return { speech: 'I will read my voice diagnostics.', actions: [{ type: 'voice.diagnostics' }], intent: 'voice' };
  }

  if (/\b(turn|switch)\s+(speech\s+)?watchdog\s+on\b/.test(lower)) {
    return { speech: 'Speech watchdog is on.', actions: [{ type: 'voice.watchdog', enabled: true }], intent: 'voice' };
  }

  if (/\b(turn|switch)\s+(speech\s+)?watchdog\s+off\b/.test(lower)) {
    return { speech: 'Speech watchdog is off.', actions: [{ type: 'voice.watchdog', enabled: false }], intent: 'voice' };
  }

  if (/\b(use|switch to)\s+offline\s+(brain|mode)\b/.test(lower)) {
    return { speech: 'Offline brain mode is active.', actions: [{ type: 'backend.set', mode: 'offline' }], intent: 'settings' };
  }
  if (/\b(use|switch to)\s+openai\s+(brain|mode)\b/.test(lower)) {
    return { speech: 'OpenAI direct brain mode is active.', actions: [{ type: 'backend.set', mode: 'openai-direct' }], intent: 'settings' };
  }
  if (/\b(use|switch to)\s+gemini\s+(brain|mode)\b/.test(lower)) {
    return { speech: 'Gemini direct brain mode is active.', actions: [{ type: 'backend.set', mode: 'gemini-direct' }], intent: 'settings' };
  }
  if (/\b(use|switch to)\s+(remote|tradjs)\s+(brain|backend|mode)\b/.test(lower)) {
    return { speech: 'Remote TradJS brain mode is active.', actions: [{ type: 'backend.set', mode: 'tradjs-remote' }], intent: 'settings' };
  }

  if (/\b(save|favorite|favourite)\s+(this|that)\b/.test(lower) || /\b(add this to favorites|remember this track|remember this video)\b/.test(lower)) {
    return { speech: 'I will save the current media as a favorite.', actions: [{ type: 'media.favorite.save' }], intent: 'favorite' };
  }

  const favoriteSearch = clean.match(/(?:play|show|list|search)\s+(?:my\s+)?favorites?(?:\s+(?:about|for)\s+(.+))?/i);
  if (favoriteSearch && /\bfavorites?\b/.test(lower)) {
    return { speech: 'I will check your media favorites.', actions: [{ type: 'media.favorite.list', query: favoriteSearch[1]?.trim() }], intent: 'favorite' };
  }

  if (/\b(clear|delete)\s+(my\s+)?favorites?\b/.test(lower)) {
    return { speech: 'I cleared your media favorites.', actions: [{ type: 'media.favorite.clear' }], intent: 'favorite' };
  }

  if (/\b(translation history|what did you translate|show translations)\b/.test(lower)) {
    return { speech: 'I will show recent translations.', actions: [{ type: 'translation.history' }], intent: 'translate' };
  }

  if (/\b(clear|delete)\s+translation\s+history\b/.test(lower)) {
    return { speech: 'I cleared translation history.', actions: [{ type: 'translation.history.clear' }], intent: 'translate' };
  }

  if (/\b(morning brief|daily brief|brief me)\b/.test(lower)) {
    return { speech: 'Here is your local brief.', actions: [{ type: 'routine.brief' }], intent: 'routine' };
  }

  if (/\b(list|show|what are)\s+(my\s+)?routines\b/.test(lower)) {
    return { speech: 'I will check your routines.', actions: [{ type: 'routine.list' }], intent: 'routine' };
  }

  if (/\b(clear|delete)\s+(all\s+)?routines\b/.test(lower)) {
    return { speech: 'I cleared your routines.', actions: [{ type: 'routine.clear' }], intent: 'routine' };
  }

  const routine = parseRoutineCommand(clean);
  if (routine) {
    return { speech: `I created the routine ${routine.title} at ${routine.timeOfDay}.`, actions: [{ type: 'routine.create', ...routine }], intent: 'routine' };
  }


  if (/\b(self\s*repair|repair yourself|heal yourself|fix yourself|restart voice|restart listening)\b/.test(lower)) {
    return { speech: 'I will run local self repair and restart my voice loop.', actions: [{ type: 'system.self_repair' }], intent: 'recovery' };
  }

  if (/\b(clear|delete)\s+(diagnostic\s+)?logs\b/.test(lower)) {
    return { speech: 'I cleared the local diagnostic logs.', actions: [{ type: 'diagnostics.clear_logs' }], intent: 'system' };
  }

  if (/\b(confirm\s+factory\s+reset|factory\s+reset\s+confirm)\b/.test(lower)) {
    return { speech: 'Factory reset confirmed.', actions: [{ type: 'system.factory_reset_confirm' }], intent: 'recovery' };
  }

  if (/\b(factory\s+reset|reset\s+everything|wipe\s+local\s+data)\b/.test(lower)) {
    return { speech: 'Factory reset is dangerous. Say confirm factory reset if you really want to erase local AGA data.', actions: [{ type: 'system.factory_reset_request' }], intent: 'recovery' };
  }

  if (/\b(export|create|copy|share)\s+(a\s+)?(local\s+)?backup\b/.test(lower) || /\bbackup\s+(my\s+)?aga\b/.test(lower)) {
    return { speech: 'I will create a local AGA backup.', actions: [{ type: 'backup.export' }], intent: 'backup' };
  }

  if (/\b(storage|database|backup)\s+(summary|status|size)\b/.test(lower)) {
    return { speech: 'I will summarize my local storage.', actions: [{ type: 'backup.summary' }], intent: 'backup' };
  }

  const historyMatch = clean.match(/(?:search|find|recall|look up)\s+(?:my\s+)?(?:history|conversation|chat|messages|local data|everything)\s+(?:about|for)\s+(.+)/i)
    ?? clean.match(/(?:what did we|what have we)\s+(?:say|talk|discuss)\s+(?:about|regarding)\s+(.+)/i);
  if (historyMatch) {
    const query = historyMatch[1].replace(/[.!?]+$/g, '').trim();
    if (query.length > 1) return { speech: `I will search local history about ${query}.`, actions: [{ type: 'history.search', query }], intent: 'history' };
  }

  if (/\b(run|test)\s+(voice\s+)?commands\b/.test(lower) || /\bcommand harness\b/.test(lower)) {
    return { speech: 'Running the local command harness.', actions: [{ type: 'command.harness' }], intent: 'system' };
  }

  if (/\b(request|ask for|enable)\s+(local\s+)?notification\s+permission\b/.test(lower)) {
    return { speech: 'I will request notification permission.', actions: [{ type: 'notifications.request' }], intent: 'notifications' };
  }

  if (/\b(turn|switch)\s+(local\s+)?notifications\s+on\b/.test(lower)) {
    return { speech: 'Local notifications are on.', actions: [{ type: 'notifications.toggle', enabled: true }, { type: 'notifications.request' }], intent: 'notifications' };
  }

  if (/\b(turn|switch)\s+(local\s+)?notifications\s+off\b/.test(lower)) {
    return { speech: 'Local notifications are off.', actions: [{ type: 'notifications.toggle', enabled: false }], intent: 'notifications' };
  }

  if (/\b(turn|switch)\s+(proactive|reminders|nudges)\s+on\b/.test(lower)) {
    return { speech: 'Proactive reminders are on.', actions: [{ type: 'proactive.toggle', enabled: true }], intent: 'settings' };
  }

  if (/\b(turn|switch)\s+(proactive|reminders|nudges)\s+off\b/.test(lower)) {
    return { speech: 'Proactive reminders are off.', actions: [{ type: 'proactive.toggle', enabled: false }], intent: 'settings' };
  }

  const rememberMatch = clean.match(/^(?:please\s+)?remember\s+(?:that\s+)?(.+)/i);
  if (rememberMatch) {
    const text = rememberMatch[1].replace(/[.!?]+$/g, '').trim();
    if (text.length > 2) {
      return { speech: `I will remember that ${text}.`, actions: [{ type: 'memory.save', text }], intent: 'memory' };
    }
  }

  if (/\b(clear|forget)\s+(everything\s+)?(?:you\s+)?remember\b/.test(lower)) {
    return { speech: 'I cleared my local memory notes.', actions: [{ type: 'memory.clear' }], intent: 'memory' };
  }

  const recallMatch = clean.match(/\b(?:what do you remember|recall memory|search memory|what have you remembered)(?:\s+(?:about|for)\s+(.+))?/i);
  if (recallMatch) {
    return { speech: 'I will check my local memory.', actions: [{ type: 'memory.recall', query: recallMatch[1]?.trim() }], intent: 'memory' };
  }

  if (/\b(list|show|what are)\s+(my\s+)?reminders\b/.test(lower)) {
    return { speech: 'I will check your reminders.', actions: [{ type: 'reminder.list' }], intent: 'reminder' };
  }

  if (/\b(cancel|clear|delete)\s+(all\s+)?reminders\b/.test(lower)) {
    return { speech: 'I cancelled your pending reminders.', actions: [{ type: 'reminder.clear' }], intent: 'reminder' };
  }

  const reminder = parseReminderCommand(clean);
  if (reminder) {
    return { speech: `Okay. I will remind you to ${reminder.title} ${formatDueForSpeech(reminder.dueAt)}.`, actions: [{ type: 'reminder.create', title: reminder.title, dueAt: reminder.dueAt }], intent: 'reminder' };
  }


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


  if (/\b(repeat translation|say translation again|repeat the translation)\b/.test(lower)) {
    return { speech: 'I will repeat the last translation.', actions: [{ type: 'translation.repeat' }], intent: 'translate' };
  }

  if (/\b(translate slower|speak translation slower|slow translation)\b/.test(lower)) {
    return { speech: 'I will slow down translation speech.', actions: [{ type: 'translation.slower' }], intent: 'translate' };
  }

  if (/\b(stop translating|end translation|translation off)\b/.test(lower)) {
    return { speech: 'Phrase translation is off.', actions: [{ type: 'translate.stop' }], intent: 'translate' };
  }

  const translateMatch = lower.match(/\b(?:translate|phrase translate|live translate).*\b(?:to|into)\s+([a-zA-Z]+)/);
  if (translateMatch) {
    const to = LANGUAGE_WORDS[translateMatch[1]] ?? translateMatch[1];
    return { speech: `Phrase translation is on. I will translate each recognized phrase to ${translateMatch[1]}.`, actions: [{ type: 'translate.start', to }], intent: 'translate' };
  }

  const personaMatch = lower.match(/\b(?:use|switch to|be|become)\s+(warm|bright|calm|coach|story|playful|wise|supportive|energetic)\b/);
  if (personaMatch) {
    const raw = personaMatch[1];
    const persona = raw === 'supportive' ? 'warm' : raw === 'wise' ? 'calm' : raw === 'playful' ? 'bright' : raw === 'energetic' ? 'coach' : raw;
    return { speech: `Okay, I will use my ${persona} voice.`, actions: [{ type: 'persona.set', persona }], intent: 'persona' };
  }


  if (/\b(what'?s|what is|show|list)\s+(in\s+)?(?:the\s+)?queue\b/.test(lower)) {
    return { speech: 'I will check the media queue.', actions: [{ type: 'media.queue.status' }], intent: 'media_queue' };
  }

  if (/\b(clear|empty)\s+(the\s+)?queue\b/.test(lower)) {
    return { speech: 'I cleared the media queue.', actions: [{ type: 'media.queue.clear' }], intent: 'media_queue' };
  }

  if (/\b(play|skip to)\s+(the\s+)?next\b/.test(lower) || /\bnext\s+(song|track|video)\b/.test(lower)) {
    return { speech: 'Playing the next queued item.', actions: [{ type: 'media.next' }], intent: 'media_queue' };
  }

  const queueYoutubeMatch = clean.match(/(?:queue|add)\s+(.+?)\s+(?:on\s+)?youtube/i);
  if (queueYoutubeMatch) {
    const query = queueYoutubeMatch[1].trim();
    return { speech: `Queued ${query} for YouTube.`, actions: [{ type: 'media.queue.add', kind: 'youtube', query }], intent: 'media_queue' };
  }

  const queueMusicMatch = clean.match(/(?:queue|add)\s+(.+?)(?:\s+music|\s+song|\s+track)?$/i);
  if (queueMusicMatch && /\b(queue|add)\b/.test(lower)) {
    const query = queueMusicMatch[1].replace(/\bmusic\b|\bsong\b|\btrack\b/gi, '').trim();
    if (query.length > 1) {
      return { speech: `Queued ${query}.`, actions: [{ type: 'media.queue.add', kind: 'music', query }], intent: 'media_queue' };
    }
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



type ParsedRoutine = { title: string; prompt: string; timeOfDay: string; daysOfWeek?: string | null };

function parseRoutineCommand(text: string): ParsedRoutine | null {
  const match = text.match(/(?:create|add|set)\s+(?:a\s+)?routine\s+(?:called\s+)?(.+?)\s+(?:at|for)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+to\s+(.+))?$/i)
    ?? text.match(/(?:every day|daily)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(.+)/i);

  if (!match) return null;
  if (match.length >= 6 && match[1] && isNaN(Number(match[1]))) {
    const title = match[1].trim();
    const timeOfDay = normalizeTime(match[2], match[3], match[4]);
    const prompt = match[5]?.trim() || `Run the ${title} routine.`;
    return { title, prompt, timeOfDay, daysOfWeek: null };
  }

  const timeOfDay = normalizeTime(match[1], match[2], match[3]);
  const prompt = match[4]?.trim() || 'Give me my daily brief.';
  return { title: 'Daily routine', prompt, timeOfDay, daysOfWeek: null };
}

function normalizeTime(hourText: string, minuteText?: string, meridianText?: string) {
  let hour = Number(hourText);
  const minute = Number(minuteText ?? 0);
  const meridian = meridianText?.toLowerCase();
  if (meridian === 'pm' && hour < 12) hour += 12;
  if (meridian === 'am' && hour === 12) hour = 0;
  return `${String(Math.max(0, Math.min(23, hour))).padStart(2, '0')}:${String(Math.max(0, Math.min(59, minute))).padStart(2, '0')}`;
}

type ParsedReminder = { title: string; dueAt: string };

function parseReminderCommand(text: string): ParsedReminder | null {
  const clean = text.trim();
  const starter = clean.match(/\bremind me to\s+(.+)/i) ?? clean.match(/\breminder to\s+(.+)/i);
  if (!starter) return null;

  const rest = starter[1].replace(/[.!?]+$/g, '').trim();
  const inMatch = rest.match(/(.+?)\s+in\s+(\d{1,3})\s*(minute|minutes|min|hour|hours|hr|hrs)\b/i);
  if (inMatch) {
    const amount = Number(inMatch[2]);
    const unit = inMatch[3].toLowerCase();
    const due = new Date();
    if (unit.startsWith('hour') || unit === 'hr' || unit === 'hrs') due.setHours(due.getHours() + amount);
    else due.setMinutes(due.getMinutes() + amount);
    return { title: inMatch[1].trim(), dueAt: due.toISOString() };
  }

  const tomorrowMatch = rest.match(/(.+?)\s+tomorrow(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?\b/i);
  if (tomorrowMatch) {
    const due = new Date();
    due.setDate(due.getDate() + 1);
    const hourRaw = tomorrowMatch[2] ? Number(tomorrowMatch[2]) : 9;
    const minute = tomorrowMatch[3] ? Number(tomorrowMatch[3]) : 0;
    const meridian = tomorrowMatch[4]?.toLowerCase();
    let hour = hourRaw;
    if (meridian === 'pm' && hour < 12) hour += 12;
    if (meridian === 'am' && hour === 12) hour = 0;
    due.setHours(hour, minute, 0, 0);
    return { title: tomorrowMatch[1].trim(), dueAt: due.toISOString() };
  }

  const atMatch = rest.match(/(.+?)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (atMatch) {
    const due = new Date();
    const hourRaw = Number(atMatch[2]);
    const minute = atMatch[3] ? Number(atMatch[3]) : 0;
    const meridian = atMatch[4]?.toLowerCase();
    let hour = hourRaw;
    if (meridian === 'pm' && hour < 12) hour += 12;
    if (meridian === 'am' && hour === 12) hour = 0;
    due.setHours(hour, minute, 0, 0);
    if (due.getTime() < Date.now() - 30_000) due.setDate(due.getDate() + 1);
    return { title: atMatch[1].trim(), dueAt: due.toISOString() };
  }

  return null;
}

function formatDueForSpeech(dueAt: string) {
  const date = new Date(dueAt);
  const now = Date.now();
  const ms = date.getTime() - now;
  if (ms > 0 && ms < 2 * 60 * 60 * 1000) {
    const minutes = Math.max(1, Math.round(ms / 60_000));
    return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  return `at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export function sanitizeTurn(input: unknown): AgaTurn | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Partial<AgaTurn>;
  if (typeof value.speech !== 'string') return null;
  const actions = Array.isArray(value.actions) ? value.actions.filter(Boolean) as AgaAction[] : [];
  const intent = typeof value.intent === 'string' ? value.intent as AssistantIntent : 'chat';
  return { speech: value.speech.trim() || 'I heard you.', actions, intent };
}
