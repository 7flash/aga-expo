import type { AgaTurn } from '../aga/actions';
import { sanitizeTurn } from '../aga/actions';
import type { Persona } from '../aga/personas';
import type { ChatMessage } from '../db/schema';

export async function askOpenAIDirect(input: {
  apiKey: string;
  model: string;
  text: string;
  history: ChatMessage[];
  persona: Persona;
  localContext?: string;
}): Promise<AgaTurn> {
  const transcript = input.history
    .slice(-16)
    .map((message) => `${message.role === 'user' ? 'User' : 'AGA'}: ${message.content}`)
    .join('\n');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: input.model,
      instructions: `${input.persona.systemPrompt}\n\nReturn ONLY JSON in this shape: {"speech":"spoken response","intent":"chat|play_music|play_youtube|media_control|translate|persona|agent|system|settings|memory|reminder|unknown","actions":[]}. Keep speech natural and short for voice. Use actions only when the user asked for a device/media/config action. Supported action examples: youtube.play, youtube.control, music.play, music.control, persona.set, translate.start, translate.stop, agent.spawn, memory.save, memory.recall, reminder.create, reminder.list, reminder.clear, proactive.toggle, system.health, system.help, conversation.reset, diagnostics.show, diagnostics.hide, voice.rate, wake.set, media.status.`,
      input: `${input.localContext ? `Local context:\n${input.localContext}\n\n` : ''}${transcript}\nUser: ${input.text}\nAGA JSON:`,
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message ?? 'OpenAI request failed.');

  const text = getOutputText(data);
  const parsed = parseJsonTurn(text);
  if (parsed) return parsed;
  return { speech: text || 'I am here.', actions: [], intent: 'chat' };
}

function getOutputText(data: any): string {
  if (typeof data.output_text === 'string') return data.output_text.trim();
  const chunks = data.output
    ?.flatMap((item: any) => item.content ?? [])
    ?.filter((content: any) => content.type === 'output_text' && typeof content.text === 'string')
    ?.map((content: any) => content.text);
  return chunks?.join('\n').trim() || '';
}

function parseJsonTurn(text: string): AgaTurn | null {
  try {
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd < jsonStart) return null;
    return sanitizeTurn(JSON.parse(text.slice(jsonStart, jsonEnd + 1)));
  } catch {
    return null;
  }
}
