import { matchPersona } from './personas';

export type AgaMode =
  | 'sleeping'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'translating'
  | 'media'
  | 'settings'
  | 'recovering'
  | 'offline';

export type AgaAction =
  | { type: 'speak'; text: string }
  | { type: 'remember'; text: string }
  | { type: 'recall'; query?: string }
  | { type: 'set_persona'; persona: string }
  | { type: 'set_wake_phrase'; phrase: string }
  | { type: 'translate_start'; target: string }
  | { type: 'translate_stop' }
  | { type: 'open_settings' }
  | { type: 'show_diagnostics' }
  | { type: 'stop_speaking' }
  | { type: 'reset_conversation' }
  | { type: 'add_reminder'; text: string; dueAt: string }
  | { type: 'list_reminders' }
  | { type: 'clear_reminders' }
  | { type: 'test_voice' }
  | { type: 'status' }
  | { type: 'chat'; text: string };

export type ParsedCommand = {
  speech: string;
  actions: AgaAction[];
  handledLocally: boolean;
};

function cleanWake(text: string, wakePhrase: string) {
  const escaped = wakePhrase.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .replace(new RegExp(`^\\s*(hey\\s+)?${escaped}[:,]?\\s*`, 'i'), '')
    .replace(/^\s*(hey\s+)?(aga|angel|okay\s+aga|ok\s+aga)[:,]?\s*/i, '')
    .trim();
}

export function hasWakeWord(text: string, wakePhrase: string) {
  const lower = text.toLowerCase();
  const phrase = wakePhrase.toLowerCase().trim();
  return (
    lower.includes(phrase) ||
    /\b(hey\s+aga|okay\s+aga|ok\s+aga|aga|angel)\b/i.test(text)
  );
}

function languageFromText(text: string) {
  const lower = text.toLowerCase();
  if (/\b(indonesian|bahasa|indo)\b/.test(lower)) return 'Indonesian';
  if (/\b(russian|русский)\b/.test(lower)) return 'Russian';
  if (/\b(spanish|español)\b/.test(lower)) return 'Spanish';
  if (/\b(english)\b/.test(lower)) return 'English';
  if (/\b(japanese)\b/.test(lower)) return 'Japanese';
  if (/\b(chinese|mandarin)\b/.test(lower)) return 'Chinese';
  return 'Indonesian';
}

function parseClockTime(raw: string) {
  const match = raw.match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
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
  const source = raw.trim();
  const cleaned = source.replace(/^remind me\s+(to\s+)?/i, '').trim();
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
    const due = new Date();
    const clock = parseClockTime(atMatch[2]);
    if (!clock) return null;
    due.setHours(clock.hour, clock.minute, 0, 0);
    if (due.getTime() < Date.now() + 30_000) due.setDate(due.getDate() + 1);
    return { text: atMatch[1].trim() || cleaned, dueAt: due.toISOString() };
  }

  return null;
}

function friendlyDue(dueAt: string) {
  const date = new Date(dueAt);
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }).format(date);
}

export function parseVoiceCommand(rawText: string, wakePhrase = 'hey aga'): ParsedCommand {
  const original = rawText.trim();
  const text = cleanWake(original, wakePhrase);
  const lower = text.toLowerCase();

  if (!text) {
    return {
      speech: 'I am listening. What would you like me to do?',
      actions: [{ type: 'speak', text: 'I am listening. What would you like me to do?' }],
      handledLocally: true,
    };
  }

  if (/\b(stop|quiet|cancel|shush|be quiet)\b/.test(lower)) {
    return { speech: 'Stopping.', actions: [{ type: 'stop_speaking' }], handledLocally: true };
  }

  if (/\b(test voice|voice test|test speech)\b/.test(lower)) {
    return { speech: 'My voice is working.', actions: [{ type: 'test_voice' }], handledLocally: true };
  }

  if (/\b(status|setup status|are you working|diagnostic summary)\b/.test(lower)) {
    return { speech: 'Checking status.', actions: [{ type: 'status' }], handledLocally: true };
  }

  if (/\b(help|what can i say|commands)\b/.test(lower)) {
    const speech =
      'You can ask me questions, say remember that, ask what I remember, set reminders, ask what reminders you have, change my voice, start phrase translation, or open settings.';
    return { speech, actions: [{ type: 'speak', text: speech }], handledLocally: true };
  }

  const reminder = parseReminder(text);
  if (reminder) {
    return {
      speech: `Okay, I will remind you ${friendlyDue(reminder.dueAt)}.`,
      actions: [{ type: 'add_reminder', ...reminder }],
      handledLocally: true,
    };
  }

  if (/\b(what are my reminders|list reminders|show reminders|pending reminders)\b/.test(lower)) {
    return { speech: 'Checking reminders.', actions: [{ type: 'list_reminders' }], handledLocally: true };
  }

  if (/\b(clear reminders|delete reminders|remove reminders)\b/.test(lower)) {
    return { speech: 'Clearing reminders.', actions: [{ type: 'clear_reminders' }], handledLocally: true };
  }

  const remember = lower.match(/(?:remember that|remember this|save memory)\s+(.+)/i);
  if (remember?.[1]) {
    const memory = remember[1].trim();
    return {
      speech: `I will remember that ${memory}`,
      actions: [{ type: 'remember', text: memory }, { type: 'speak', text: `I will remember that ${memory}` }],
      handledLocally: true,
    };
  }

  const recall = lower.match(/(?:what do you remember|search memory(?: about)?|remember anything about)\s*(.*)/i);
  if (recall) {
    return { speech: 'Let me check my memory.', actions: [{ type: 'recall', query: recall[1]?.trim() || undefined }], handledLocally: true };
  }

  const persona = matchPersona(text);
  if (/\b(change|switch|be|use)\b/.test(lower) && persona) {
    return {
      speech: `Switching to ${persona} mode.`,
      actions: [{ type: 'set_persona', persona }, { type: 'speak', text: `Okay, I am in ${persona} mode.` }],
      handledLocally: true,
    };
  }

  const wakePhraseMatch = text.match(/set wake phrase to\s+(.+)/i);
  if (wakePhraseMatch?.[1]) {
    return {
      speech: `Wake phrase set to ${wakePhraseMatch[1].trim()}.`,
      actions: [{ type: 'set_wake_phrase', phrase: wakePhraseMatch[1].trim() }, { type: 'speak', text: `Wake phrase set to ${wakePhraseMatch[1].trim()}.` }],
      handledLocally: true,
    };
  }

  if (/\b(open settings|show settings|settings)\b/.test(lower)) {
    return { speech: 'Opening settings.', actions: [{ type: 'open_settings' }], handledLocally: true };
  }

  if (/\b(show diagnostics|hide diagnostics|debug)\b/.test(lower)) {
    return { speech: 'Toggling diagnostics.', actions: [{ type: 'show_diagnostics' }], handledLocally: true };
  }

  if (/\b(reset conversation|clear conversation)\b/.test(lower)) {
    return { speech: 'Conversation cleared.', actions: [{ type: 'reset_conversation' }, { type: 'speak', text: 'Conversation cleared.' }], handledLocally: true };
  }

  if (/\b(stop translating|turn off translation|stop translate)\b/.test(lower)) {
    return { speech: 'Phrase translation is off.', actions: [{ type: 'translate_stop' }, { type: 'speak', text: 'Phrase translation is off.' }], handledLocally: true };
  }

  const translate = lower.match(/(?:translate|translation).*?(?:to|into)\s+([a-zа-яё\s]+)/i);
  if (translate) {
    const target = languageFromText(translate[1]);
    return {
      speech: `Phrase translation to ${target} is on.`,
      actions: [{ type: 'translate_start', target }, { type: 'speak', text: `Phrase translation to ${target} is on.` }],
      handledLocally: true,
    };
  }

  return { speech: '', actions: [{ type: 'chat', text }], handledLocally: false };
}
