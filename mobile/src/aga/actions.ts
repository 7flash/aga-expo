import { matchPersona } from './personas';
import { normalizeSpeech, removeWakePhrase, wakeRegex } from './text';
import type { AgaAction, AgaMode, AgaTurn } from './turn';

export type { AgaAction, AgaMode, AgaTurn };

export type ParsedCommand = AgaTurn & { handledLocally: boolean };

export function hasWakeWord(text: string, wakePhrase: string) {
  return wakeRegex(wakePhrase).test(normalizeSpeech(text));
}

function languageFromText(text: string) {
  const lower = normalizeSpeech(text).toLowerCase();
  if (/(?:indonesian|bahasa|indo)/.test(lower)) return 'Indonesian';
  if (/(?:russian|русск)/.test(lower)) return 'Russian';
  if (/(?:spanish|español|espanol)/.test(lower)) return 'Spanish';
  if (/(?:english)/.test(lower)) return 'English';
  if (/(?:japanese|nihongo)/.test(lower)) return 'Japanese';
  if (/(?:chinese|mandarin)/.test(lower)) return 'Chinese';
  return 'Indonesian';
}

function parseClockTime(raw: string) {
  const match = normalizeSpeech(raw).match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const period = match[3]?.toLowerCase();
  if (period === 'pm' && hour < 12) hour += 12;
  if (period === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function parseReminder(raw: string): { text: string; dueAt: string } | null {
  const source = normalizeSpeech(raw);
  const cleaned = source.replace(/^remind\s+me\s+(?:to\s+)?/i, '').trim();
  if (!cleaned) return null;

  const inMatch = cleaned.match(/^(.*?)\s+in\s+(\d+)\s*(second|seconds|minute|minutes|hour|hours|day|days)\b/i);
  if (inMatch) {
    const text = inMatch[1].trim();
    const amount = Number(inMatch[2]);
    const unit = inMatch[3].toLowerCase();
    const due = new Date();
    if (unit.startsWith('second')) due.setSeconds(due.getSeconds() + amount);
    else if (unit.startsWith('minute')) due.setMinutes(due.getMinutes() + amount);
    else if (unit.startsWith('hour')) due.setHours(due.getHours() + amount);
    else due.setDate(due.getDate() + amount);
    return { text: text || cleaned, dueAt: due.toISOString() };
  }

  const tomorrowMatch = cleaned.match(/^(.*?)\s+tomorrow(?:\s+at\s+(.+))?$/i);
  if (tomorrowMatch) {
    const due = new Date();
    due.setDate(due.getDate() + 1);
    const clock = parseClockTime(tomorrowMatch[2] ?? '9:00');
    due.setHours(clock?.hour ?? 9, clock?.minute ?? 0, 0, 0);
    return { text: tomorrowMatch[1].trim() || cleaned, dueAt: due.toISOString() };
  }

  const atMatch = cleaned.match(/^(.*?)\s+at\s+(.+)$/i);
  if (atMatch) {
    const clock = parseClockTime(atMatch[2]);
    if (!clock) return null;
    const due = new Date();
    due.setHours(clock.hour, clock.minute, 0, 0);
    if (due.getTime() < Date.now() + 30_000) due.setDate(due.getDate() + 1);
    return { text: atMatch[1].trim() || cleaned, dueAt: due.toISOString() };
  }

  return null;
}

function friendlyDue(dueAt: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(new Date(dueAt));
}

/** Extract a clean media search query from “play X on YouTube” and natural media commands. */
function parseYouTube(text: string): string | null {
  const lower = text.toLowerCase();
  const explicit =
    lower.match(/(?:play|put\s+on|pull\s+up|show|watch|find|search)\s+(.+?)\s+(?:on\s+|in\s+)?youtube\b/i) ||
    lower.match(/(?:youtube|the\s+video|a\s+video|video\s+of|play\s+video)\s+(?:for\s+|of\s+|about\s+)?(.+)/i);
  if (explicit?.[1]) return explicit[1].trim();

  // Generic "play <something>" with no other handler becomes media.
  const generic = lower.match(/^(?:play|put\s+on|pull\s+up)\s+(.+)/i);
  if (generic?.[1]) return generic[1].replace(/\s+(?:please|for\s+me)$/i, '').trim();
  return null;
}

export function parseVoiceCommand(rawText: string, wakePhrase = 'hey aga'): ParsedCommand {
  const original = normalizeSpeech(rawText);
  const text = removeWakePhrase(original, wakePhrase);
  const lower = text.toLowerCase();

  if (!text) {
    const speech = 'I am listening. What would you like me to do?';
    return { speech, intent: 'system', actions: [{ type: 'speak', text: speech }], handledLocally: true };
  }

  // Media transport first so “stop the video” does not get swallowed as generic stop.
  if (/(?:stop|close|end)\s+(?:the\s+)?(?:video|music|song|youtube)/.test(lower)) {
    return { speech: 'Stopping playback.', intent: 'media_control', actions: [{ type: 'media_stop' }], handledLocally: true };
  }
  if (/^(?:pause|hold\s+(?:on|that))\b/.test(lower)) {
    return { speech: 'Paused.', intent: 'media_control', actions: [{ type: 'media_pause' }], handledLocally: true };
  }
  if (/(?:resume|continue|keep\s+playing|play\s+again|unpause)/.test(lower)) {
    return { speech: 'Resuming.', intent: 'media_control', actions: [{ type: 'media_resume' }], handledLocally: true };
  }

  const ytQuery = parseYouTube(text);
  if (ytQuery) {
    return {
      speech: `Pulling up ${ytQuery}.`,
      intent: 'youtube',
      actions: [{ type: 'play_youtube', query: ytQuery }],
      handledLocally: true,
    };
  }

  if (/(?:^|\s)(?:stop|quiet|cancel|shush|be\s+quiet|hush)(?:\s|$)/.test(lower)) {
    return { speech: 'Stopping.', intent: 'system', actions: [{ type: 'stop_speaking' }], handledLocally: true };
  }
  if (/(?:test\s+voice|voice\s+test|test\s+speech|say\s+something)/.test(lower)) {
    return { speech: 'My voice is working.', intent: 'system', actions: [{ type: 'test_voice' }], handledLocally: true };
  }
  if (/(?:status|setup\s+status|are\s+you\s+(?:there|working)|diagnostic\s+summary)/.test(lower)) {
    return { speech: 'Checking status.', intent: 'system', actions: [{ type: 'status' }], handledLocally: true };
  }
  if (/(?:help|what\s+can\s+i\s+(?:say|ask)|commands|what\s+can\s+you\s+do)/.test(lower)) {
    const speech = 'I can give advice, play YouTube videos, set reminders, remember things, switch how I sound, translate phrases, and more. Just talk to me — no buttons needed.';
    return { speech, intent: 'system', actions: [{ type: 'speak', text: speech }], handledLocally: true };
  }

  const reminder = parseReminder(text);
  if (reminder) {
    return {
      speech: `Okay, I will remind you ${friendlyDue(reminder.dueAt)}.`,
      intent: 'reminder',
      actions: [{ type: 'add_reminder', ...reminder }],
      handledLocally: true,
    };
  }
  if (/(?:what\s+are\s+my\s+reminders|list\s+reminders|show\s+reminders|pending\s+reminders)/.test(lower)) {
    return { speech: 'Checking reminders.', intent: 'reminder', actions: [{ type: 'list_reminders' }], handledLocally: true };
  }
  if (/(?:clear|delete|remove)\s+(?:all\s+)?reminders/.test(lower)) {
    return { speech: 'Clearing reminders.', intent: 'reminder', actions: [{ type: 'clear_reminders' }], handledLocally: true };
  }
  if (/(?:enable notifications|turn on notifications|notification permission)/.test(lower)) {
    return { speech: 'Checking notification permission.', intent: 'notifications', actions: [{ type: 'request_notifications' }], handledLocally: true };
  }

  const remember = text.match(/(?:remember\s+that|remember\s+this|save\s+(?:a\s+)?memory)\s+(.+)/i);
  if (remember?.[1]) {
    const memory = remember[1].trim();
    return {
      speech: `I will remember that ${memory}.`,
      intent: 'memory',
      actions: [{ type: 'remember', text: memory }, { type: 'speak', text: `I will remember that ${memory}.` }],
      handledLocally: true,
    };
  }

  const recall = text.match(/(?:what\s+do\s+you\s+remember|search\s+memory(?:\s+about)?|remember\s+anything\s+about)\s*(.*)/i);
  if (recall) {
    return { speech: 'Let me check my memory.', intent: 'memory', actions: [{ type: 'recall', query: recall[1]?.trim() || undefined }], handledLocally: true };
  }

  const persona = matchPersona(text);
  if (/(?:change|switch|be|use|sound)/.test(lower) && persona) {
    return {
      speech: `Switching to ${persona} mode.`,
      intent: 'persona',
      actions: [{ type: 'set_persona', persona }, { type: 'speak', text: `Okay, I am in ${persona} mode.` }],
      handledLocally: true,
    };
  }

  const wakePhraseMatch = text.match(/set\s+wake\s+phrase\s+to\s+(.+)/i);
  if (wakePhraseMatch?.[1]) {
    const phrase = wakePhraseMatch[1].trim();
    return {
      speech: `Wake phrase set to ${phrase}.`,
      intent: 'settings',
      actions: [{ type: 'set_wake_phrase', phrase }, { type: 'speak', text: `Wake phrase set to ${phrase}.` }],
      handledLocally: true,
    };
  }

  if (/(?:open\s+settings|show\s+settings)/.test(lower)) {
    return { speech: 'Opening settings.', intent: 'settings', actions: [{ type: 'open_settings' }], handledLocally: true };
  }
  if (/(?:show|hide|toggle)\s+diagnostics|debug\s+mode/.test(lower)) {
    return { speech: 'Toggling diagnostics.', intent: 'system', actions: [{ type: 'show_diagnostics' }], handledLocally: true };
  }
  if (/(?:reset|clear)\s+(?:the\s+)?conversation/.test(lower)) {
    return { speech: 'Conversation cleared.', intent: 'system', actions: [{ type: 'reset_conversation' }, { type: 'speak', text: 'Conversation cleared.' }], handledLocally: true };
  }

  if (/(?:stop\s+translating|turn\s+off\s+translation|stop\s+translate)/.test(lower)) {
    return { speech: 'Phrase translation is off.', intent: 'translation', actions: [{ type: 'translate_stop' }, { type: 'speak', text: 'Phrase translation is off.' }], handledLocally: true };
  }
  const translate = lower.match(/(?:translate|translation).*?(?:to|into)\s+([a-zа-яё\s]+)/i);
  if (translate) {
    const target = languageFromText(translate[1]);
    return {
      speech: `Phrase translation to ${target} is on.`,
      intent: 'translation',
      actions: [{ type: 'translate_start', target }, { type: 'speak', text: `Phrase translation to ${target} is on.` }],
      handledLocally: true,
    };
  }

  return { speech: '', intent: 'chat', actions: [{ type: 'chat', text }], handledLocally: false };
}
