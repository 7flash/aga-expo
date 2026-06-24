import type { AgaTurn } from '../aga/actions';
import { sanitizeTurn } from '../aga/actions';
import type { Persona } from '../aga/personas';
import type { ChatMessage } from '../db/schema';

export async function askTradjsRemote(input: {
  baseUrl: string;
  token?: string | null;
  text: string;
  history: ChatMessage[];
  persona: Persona;
  localContext?: string;
}): Promise<AgaTurn> {
  const base = input.baseUrl.replace(/\/$/, '');
  const response = await fetch(`${base}/api/assistant/turn`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
    },
    body: JSON.stringify({
      message: input.text,
      text: input.text,
      history: input.history.slice(-24),
      persona: input.persona.name,
      localContext: input.localContext ?? '',
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? data?.message ?? 'Remote AGA brain failed.');
  const turn = sanitizeTurn(data?.turn ?? data);
  return turn ?? { speech: data?.reply ?? data?.speech ?? 'Remote brain answered, but I could not parse its action envelope.', actions: [], intent: 'chat' };
}
