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

  if (/\b(help|what can i say|commands)\b/.test(lower)) {
    const speech =
      'You can ask me questions, say remember that, ask what I remember, change my voice, start phrase translation, or open settings.';
    return { speech, actions: [{ type: 'speak', text: speech }], handledLocally: true };
  }

  if (/\b(open|show)\s+(settings|setup)\b/.test(lower)) {
    return { speech: 'Opening settings.', actions: [{ type: 'open_settings' }], handledLocally: true };
  }

  if (/\b(show|open)\s+(diagnostics|debug|status)\b/.test(lower) || /\bsetup status\b/.test(lower)) {
    return { speech: 'Showing diagnostics.', actions: [{ type: 'show_diagnostics' }], handledLocally: true };
  }

  const rememberMatch = text.match(/^(?:please\s+)?remember(?:\s+that)?\s+(.+)$/i);
  if (rememberMatch?.[1]) {
    const memory = rememberMatch[1].trim();
    return {
      speech: `I will remember: ${memory}`,
      actions: [{ type: 'remember', text: memory }, { type: 'speak', text: `I will remember that.` }],
      handledLocally: true,
    };
  }

  const recallMatch = text.match(/^(?:what do you remember|search memory(?: about)?|what did i tell you about)\s*(.*)$/i);
  if (recallMatch) {
    return {
      speech: 'Checking memory.',
      actions: [{ type: 'recall', query: recallMatch[1]?.trim() || undefined }],
      handledLocally: true,
    };
  }

  const wakeMatch = text.match(/^(?:set|change)\s+wake\s+(?:word|phrase)\s+(?:to\s+)?(.+)$/i);
  if (wakeMatch?.[1]) {
    const phrase = wakeMatch[1].trim();
    return {
      speech: `Wake phrase changed to ${phrase}.`,
      actions: [{ type: 'set_wake_phrase', phrase }, { type: 'speak', text: `Okay. My wake phrase is now ${phrase}.` }],
      handledLocally: true,
    };
  }

  const persona = matchPersona(text);
  if (/\b(change|switch|use|be|voice|style|persona)\b/.test(lower) && persona) {
    return {
      speech: 'Changing my voice style.',
      actions: [{ type: 'set_persona', persona }, { type: 'speak', text: 'Okay. I changed my voice style.' }],
      handledLocally: true,
    };
  }

  const translateMatch = text.match(/^(?:start\s+)?(?:phrase\s+)?translat(?:e|ion)(?:\s+to)?\s+(.+)$/i);
  if (translateMatch?.[1]) {
    const target = translateMatch[1].replace(/mode$/i, '').trim();
    return {
      speech: `Phrase translation to ${target} is on.`,
      actions: [{ type: 'translate_start', target }, { type: 'speak', text: `Phrase translation to ${target} is on.` }],
      handledLocally: true,
    };
  }

  if (/\b(stop|end|cancel)\s+(translation|translating)\b/.test(lower)) {
    return {
      speech: 'Phrase translation is off.',
      actions: [{ type: 'translate_stop' }, { type: 'speak', text: 'Phrase translation is off.' }],
      handledLocally: true,
    };
  }

  if (/\b(reset|clear)\s+(chat|conversation)\b/.test(lower)) {
    return {
      speech: 'Starting a fresh conversation.',
      actions: [{ type: 'reset_conversation' }, { type: 'speak', text: 'Starting a fresh conversation.' }],
      handledLocally: true,
    };
  }

  return {
    speech: '',
    actions: [{ type: 'chat', text }],
    handledLocally: false,
  };
}
