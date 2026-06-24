import type { AgaTurn } from './actions';
import { inferLocalActions } from './actions';
import type { Persona } from './personas';
import type { ChatMessage } from '../db/schema';
import { askBrain } from '../backend/client';

export async function createAgaTurn(input: {
  text: string;
  history: ChatMessage[];
  persona: Persona;
  translateTarget?: string | null;
}): Promise<AgaTurn> {
  const local = inferLocalActions(input.text);
  if (local) return local;

  if (input.translateTarget) {
    return {
      speech: input.text,
      actions: [{ type: 'translate.start', to: input.translateTarget }],
      intent: 'translate',
    };
  }

  return askBrain({
    text: input.text,
    history: input.history,
    persona: input.persona,
  });
}
