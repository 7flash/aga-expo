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
  if (/\b(indonesian|bahasa|indo)\b/.test(lower)) return 'Indonesian';
  if (/\b(russian|русский)\b/.test(lower)) return 'Russian';
  if (/\b(spanish|español)\b/.test(lower)) return 'Spanish';
  if (/\b(english)\b/.test(lower)) return 'English';
  if (/\b(japanese)\b/.test(lower)) return 'Japanese';
  if (/\b(chinese|mandarin)\b/.test(lower)) return 'Chinese';
  return 'Indonesian';
}

function parseClockTime(raw: string) {
  const match = normalizeSpeech(raw).match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
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

function parseYouTube(text: string) {
  const match = text.match(/(?:play|pull up|show|open|watch)\s+(.+?)(?:\s+(?:on\s+)?youtube)?$/i);
  if (!match?.[1]) return null;
  if (!/\b(youtube|video|watch|play|music|song|lofi|lo-fi|podcast|lecture|tutorial)\b/i.test(text)) return null;
  const query = match[1].replace(/\b(on\s+)?youtube\b/i, '').trim();
  return query || null;
}

export function parseVoiceCommand(rawText: string, wakePhrase = 'hey aga'): ParsedCommand {
  const original = normalizeSpeech(rawText);
  const text = removeWakePhrase(original, wakePhrase);
  const lower = text.toLowerCase();

  if (!text) {
    return {
      speech: 'I am listening. What would you like me to do?',
      intent: 'system',
      actions: [{ type: 'speak', text: 'I am listening. What would you like me to do?' }],
      handledLocally: true,
    };
  }

  if (/\b(stop|quiet|cancel|shush|be quiet)\b/.test(lower)) {
    return { speech: 'Stopping.', intent: 'system', actions: [{ type: 'stop_speaking' }, { type: 'media_stop' }], handledLocally: true };
  }

  if (/\b(pause|hold video|pause video|pause music)\b/.test(lower)) {
    return { speech: 'Paused.', intent: 'media_control', actions: [{ type: 'media_pause' }], handledLocally: true };
  }

  if (/\b(resume|continue|play again|resume video|resume music)\b/.test(lower)) {
    return { speech: 'Resuming.', intent: 'media_control', actions: [{ type: 'media_resume' }], handledLocally: true };
  }

  const youtubeQuery = parseYouTube(text);
  if (youtubeQuery) {
    return {
      speech: `Opening ${youtubeQuery} on YouTube.`,
      intent: 'youtube',
      actions: [{ type: 'youtube_play', query: youtubeQuery }],
      handledLocally: true,
    };
  }

  if (/\b(test voice|voice test|test speech)\b/.test(lower)) {
    return { speech: 'My voice is working.', intent: 'system', actions: [{ type: 'test_voice' }], handledLocally: true };
  }

  if (/\b(status|setup status|are you working|diagnostic summary)\b/.test(lower)) {
    return { speech: 'Checking status.', intent: 'system', actions: [{ type: 'status' }], handledLocally: true };
  }

  if (/\b(help|what can i say|commands)\b/.test(lower)) {
    const speech = 'You can talk naturally, ask for advice, set reminders, ask what I remember, translate phrases, or ask me to play a YouTube video.';
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

  if (/\b(what are my reminders|list reminders|show reminders|pending reminders)\b/.test(lower)) {
    return { speech: 'Checking reminders.', intent: 'reminder', actions: [{ type: 'list_reminders' }], handledLocally: true };
  }

  if (/\b(clear reminders|delete reminders|remove reminders)\b/.test(lower)) {
    return { speech: 'Clearing reminders.', intent: 'reminder', actions: [{ type: 'clear_reminders' }], handledLocally: true };
  }

  if (/\b(enable notifications|turn on notifications|notification permission)\b/.test(lower)) {
    return { speech: 'Checking notification permission.', intent: 'notifications', actions: [{ type: 'request_notifications' }], handledLocally: true };
  }

  const remember = text.match(/(?:remember that|remember this|save memory)\s+(.+)/i);
  if (remember?.[1]) {
    const memory = remember[1].trim();
    return {
      speech: `I will remember that ${memory}`,
      intent: 'memory',
      actions: [{ type: 'remember', text: memory }, { type: 'speak', text: `I will remember that ${memory}` }],
      handledLocally: true,
    };
  }

  const recall = text.match(/(?:what do you remember|search memory(?: about)?|remember anything about)\s*(.*)/i);
  if (recall) {
    return { speech: 'Let me check my memory.', intent: 'memory', actions: [{ type: 'recall', query: recall[1]?.trim() || undefined }], handledLocally: true };
  }

  const persona = matchPersona(text);
  if (/\b(change|switch|be|use)\b/.test(lower) && persona) {
    return {
      speech: `Switching to ${persona} mode.`,
      intent: 'persona',
      actions: [{ type: 'set_persona', persona }, { type: 'speak', text: `Okay, I am in ${persona} mode.` }],
      handledLocally: true,
    };
  }

  const wakePhraseMatch = text.match(/set wake phrase to\s+(.+)/i);
  if (wakePhraseMatch?.[1]) {
    const phrase = wakePhraseMatch[1].trim();
    return {
      speech: `Wake phrase set to ${phrase}.`,
      intent: 'settings',
      actions: [{ type: 'set_wake_phrase', phrase }, { type: 'speak', text: `Wake phrase set to ${phrase}.` }],
      handledLocally: true,
    };
  }

  if (/\b(open settings|show settings|settings)\b/.test(lower)) {
    return { speech: 'Opening settings.', intent: 'settings', actions: [{ type: 'open_settings' }], handledLocally: true };
  }

  if (/\b(show diagnostics|hide diagnostics|debug)\b/.test(lower)) {
    return { speech: 'Toggling diagnostics.', intent: 'system', actions: [{ type: 'show_diagnostics' }], handledLocally: true };
  }

  if (/\b(reset conversation|clear conversation)\b/.test(lower)) {
    return { speech: 'Conversation cleared.', intent: 'system', actions: [{ type: 'reset_conversation' }, { type: 'speak', text: 'Conversation cleared.' }], handledLocally: true };
  }

  if (/\b(stop translating|turn off translation|stop translate)\b/.test(lower)) {
    return { speech: 'Phrase translation is off.', intent: 'translation', actions: [{ type: 'translate_stop' }, { type: 'speak', text: 'Phrase translation is off.' }], handledLocally: true };
  }

  const translate = text.match(/(?:translate|translation).*?(?:to|into)\s+([a-zа-яё\s]+)/i);
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
