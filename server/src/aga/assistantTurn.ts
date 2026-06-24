import type { LlmMessage } from '../openai';
import { askAssistantTurn } from '../openai';
import { deterministicTurn, sanitizeActions, type AgaAction, type AgaTurn } from './actions';
import { getActivePersona } from './personas';
import { measured } from '../measure';

function mergeActions(base: AgaAction[], extra: AgaAction[]) {
  const seen = new Set<string>();
  const merged: AgaAction[] = [];

  for (const item of [...base, ...extra]) {
    const key = `${item.type}:${JSON.stringify(item.payload ?? {})}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  return merged;
}

export async function buildAssistantTurn(input: {
  command: string;
  history: LlmMessage[];
  allowModelActions?: boolean;
}): Promise<AgaTurn> {
  return measured('aga.turn.build', async () => {
    const deterministic = deterministicTurn(input.command);
    const needsModelSpeech = deterministic.actions.some((a) => a.type === 'chat.reply') || !deterministic.speech;

    if (!needsModelSpeech && !input.allowModelActions) return deterministic;

    try {
      const persona = getActivePersona();
      const modelTurn = await askAssistantTurn(input.history, {
        command: input.command,
        deterministicIntent: deterministic.intent.name,
        personaPrompt: persona.systemPrompt,
        allowActions: Boolean(input.allowModelActions),
      });

      const modelActions = sanitizeActions(modelTurn.actions);
      return {
        ...deterministic,
        speech: modelTurn.speech || deterministic.speech || 'I’m here with you.',
        actions: mergeActions(deterministic.actions.filter((a) => a.type !== 'chat.reply'), modelActions),
      };
    } catch (error) {
      if (deterministic.speech) return deterministic;
      return {
        ...deterministic,
        speech: `I hit a thinking glitch: ${error instanceof Error ? error.message : 'unknown error'}.`,
        actions: deterministic.actions,
      };
    }
  });
}
