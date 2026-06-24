import { z } from 'sqlite-zod-orm';
import { classifyIntent, type AssistantIntent } from '../intent';

export const actionTypeSchema = z.enum([
  'chat.reply',
  'youtube.play',
  'youtube.control',
  'music.play',
  'music.control',
  'persona.set',
  'translate.start',
  'translate.stop',
  'agent.spawn',
  'memory.save',
  'system.help',
  'system.health',
  'system.recover',
  'system.listen',
  'system.stop_listening',
  'conversation.reset',
]);

export type ActionType = z.infer<typeof actionTypeSchema>;

export type AgaAction = {
  type: ActionType;
  payload: Record<string, unknown>;
  confidence: number;
  spokenSummary?: string;
};

export type AgaTurn = {
  speech: string;
  actions: AgaAction[];
  intent: AssistantIntent;
  requiresConfirmation?: boolean;
};

export function action(type: ActionType, payload: Record<string, unknown> = {}, confidence = 0.9, spokenSummary?: string): AgaAction {
  return { type, payload, confidence, spokenSummary };
}

function mediaControlAction(intent: AssistantIntent): AgaAction {
  const raw = String(intent.args?.action ?? intent.normalized);
  let command = 'toggle';

  if (/pause/.test(raw)) command = 'pause';
  else if (/resume|continue|play/.test(raw)) command = 'resume';
  else if (/stop/.test(raw)) command = 'stop';
  else if (/next/.test(raw)) command = 'next';
  else if (/previous|back/.test(raw)) command = 'previous';
  else if (/mute/.test(raw) && !/unmute/.test(raw)) command = 'mute';
  else if (/unmute/.test(raw)) command = 'unmute';
  else if (/volume/.test(raw)) command = 'volume';

  return action('youtube.control', { command, volume: intent.args?.volume ?? null }, intent.confidence, intent.spokenSummary);
}

export function actionsFromIntent(intent: AssistantIntent): AgaAction[] {
  switch (intent.name) {
    case 'help':
      return [action('system.help', {}, intent.confidence, intent.spokenSummary)];
    case 'health_check':
      return [action('system.health', {}, intent.confidence, intent.spokenSummary)];
    case 'start_translation':
      return [
        action('translate.start', {
          sourceLanguage: String(intent.args?.sourceLanguage ?? 'auto'),
          targetLanguage: String(intent.args?.targetLanguage ?? 'English'),
        }, intent.confidence, intent.spokenSummary),
      ];
    case 'stop_translation':
      return [action('translate.stop', {}, intent.confidence, intent.spokenSummary)];
    case 'play_music':
      return [action('music.play', { query: String(intent.args?.query ?? intent.command) }, intent.confidence, intent.spokenSummary)];
    case 'youtube_search':
      return [action('youtube.play', { query: String(intent.args?.query ?? intent.command) }, intent.confidence, intent.spokenSummary)];
    case 'media_control':
      return [mediaControlAction(intent), action('music.control', mediaControlAction(intent).payload, intent.confidence, intent.spokenSummary)];
    case 'configure_voice':
      return [action('persona.set', { text: intent.command }, intent.confidence, intent.spokenSummary)];
    case 'configure_name':
      return [action('persona.set', { assistantName: intent.args?.assistantName ?? 'AGA' }, intent.confidence, intent.spokenSummary)];
    case 'configure_wake_word':
      return [action('persona.set', { wakeWord: intent.args?.wakeWord ?? 'Hey AGA' }, intent.confidence, intent.spokenSummary)];
    case 'reset_conversation':
      return [action('conversation.reset', {}, intent.confidence, intent.spokenSummary)];
    case 'start_listening':
      return [action('system.listen', {}, intent.confidence, intent.spokenSummary)];
    case 'stop_listening':
      return [action('system.stop_listening', {}, intent.confidence, intent.spokenSummary)];
    case 'agent_task':
      return [action('agent.spawn', { goal: String(intent.args?.goal ?? intent.command) }, intent.confidence, intent.spokenSummary)];
    case 'unknown':
      return [action('system.recover', { reason: intent.spokenSummary }, intent.confidence, intent.spokenSummary)];
    default:
      return [action('chat.reply', { message: intent.command }, intent.confidence, intent.spokenSummary)];
  }
}

export function deterministicTurn(command: string): AgaTurn {
  const intent = classifyIntent(command);
  const actions = actionsFromIntent(intent);
  const primary = actions[0];

  let speech = 'I’m on it.';

  switch (primary?.type) {
    case 'system.help':
      speech = 'You can say: Hey AGA, ask a question; play music; open YouTube; translate to Indonesian; pause; repeat; restart listening; health check; or run an agent task.';
      break;
    case 'system.health':
      speech = 'I’ll run a quick system check.';
      break;
    case 'translate.start':
      speech = `Translation mode is on. I’ll translate incoming speech to ${String(primary.payload.targetLanguage ?? 'English')}.`;
      break;
    case 'translate.stop':
      speech = 'Translation mode is off.';
      break;
    case 'youtube.play':
      speech = `Opening YouTube for ${String(primary.payload.query ?? command)}.`;
      break;
    case 'music.play':
      speech = `Playing music for ${String(primary.payload.query ?? command)}.`;
      break;
    case 'persona.set':
      speech = 'I’ll update my voice and personality settings.';
      break;
    case 'agent.spawn':
      speech = 'I’ll start an agent task and report back clearly.';
      break;
    case 'conversation.reset':
      speech = 'Fresh conversation started.';
      break;
    case 'system.recover':
      speech = 'I did not catch that clearly. Say Hey AGA and try again.';
      break;
    case 'chat.reply':
      speech = '';
      break;
  }

  return {
    speech,
    actions,
    intent,
    requiresConfirmation: intent.needsConfirmation,
  };
}

export function sanitizeActions(value: unknown): AgaAction[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>;
    const parsed = actionTypeSchema.safeParse(candidate.type);
    if (!parsed.success) return [];
    return [
      action(
        parsed.data,
        candidate.payload && typeof candidate.payload === 'object' ? (candidate.payload as Record<string, unknown>) : {},
        typeof candidate.confidence === 'number' ? candidate.confidence : 0.7,
        typeof candidate.spokenSummary === 'string' ? candidate.spokenSummary : undefined
      ),
    ];
  });
}
