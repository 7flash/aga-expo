import { detectWake, normalizeSpeech, stripWakePrefix } from './text';
import { sanitizeTurn } from './turn';
import type { AgaAction, AgaIntent, AgaMode, AgaTurn } from './turn';

export type ParsedCommand = AgaTurn & {
  rawText: string;
  text: string;
  woke: boolean;
};

export type { AgaAction, AgaIntent, AgaMode, AgaTurn } from './turn';
export { sanitizeAction, sanitizeTurn } from './turn';

export function hasWakeWord(text: string, wakePhrase = 'aga') {
  return detectWake(text, wakePhrase).woke;
}

function action(type: AgaAction['type'], extra: Record<string, unknown> = {}): AgaAction {
  return { type, ...extra } as AgaAction;
}

function inferLocalActions(text: string): AgaAction[] {
  const clean = normalizeSpeech(text).toLowerCase();
  const actions: AgaAction[] = [];

  if (/\b(stop|quiet|cancel|shush|hush)\b/.test(clean)) actions.push(action('stop_speaking'));
  if (/\b(pause|hold)\b/.test(clean)) actions.push(action('media_pause'));
  if (/\b(resume|continue)\b/.test(clean)) actions.push(action('media_resume'));
  if (/\b(reset context|start over|new session|fresh session|clear context)\b/.test(clean)) actions.push(action('reset_conversation'));
  if (/\b(open|show)\b.*\b(settings|menu|options)\b|^\s*(settings|menu|options)\s*$/.test(clean)) actions.push(action('open_settings'));
  if (/\b(play|open|show|search|pull up)\b.*\b(youtube|video|music|song)\b/.test(clean)) actions.push(action('play_youtube', { query: text }));

  return actions;
}

function inferIntent(actions: AgaAction[], text: string): AgaIntent {
  if (actions.some((a) => a.type === 'play_youtube')) return 'youtube';
  if (actions.some((a) => a.type === 'media_pause' || a.type === 'media_resume' || a.type === 'media_stop')) return 'media_control';
  if (actions.some((a) => a.type === 'open_settings')) return 'settings';
  if (actions.some((a) => a.type === 'reset_conversation' || a.type === 'stop_speaking')) return 'system';
  if (/\b(remind|reminder|timer)\b/i.test(text)) return 'reminder';
  if (/\b(remember|forget|recall)\b/i.test(text)) return 'memory';
  return 'chat';
}

export function parseVoiceCommand(text: string, wakePhrase = 'aga'): ParsedCommand {
  const rawText = String(text ?? '');
  const woke = hasWakeWord(rawText, wakePhrase);
  const clean = normalizeSpeech(stripWakePrefix(rawText, wakePhrase) || rawText);
  const actions = inferLocalActions(clean);

  return sanitizeTurn({
    rawText,
    text: clean,
    speech: '',
    intent: inferIntent(actions, clean),
    actions: actions.length ? actions : [{ type: 'chat', text: clean }],
    handledLocally: actions.length > 0,
    woke,
  } as ParsedCommand) as ParsedCommand;
}
