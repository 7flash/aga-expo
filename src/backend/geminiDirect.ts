import type { AgaTurn } from '../aga/actions';
import { sanitizeTurn } from '../aga/actions';
import type { Persona } from '../aga/personas';
import type { ChatMessage } from '../db/schema';

export async function askGeminiDirect(input: {
  apiKey: string;
  model: string;
  text: string;
  history: ChatMessage[];
  persona: Persona;
  localContext?: string;
}): Promise<AgaTurn> {
  const prompt = `${input.persona.systemPrompt}\n\nReturn ONLY JSON in this shape: {"speech":"spoken response","intent":"chat|play_music|play_youtube|media_control|translate|persona|agent|system|settings|memory|reminder|unknown","actions":[]}. Keep speech natural and short for voice. Supported action examples: youtube.play, youtube.control, music.play, music.control, persona.set, translate.start, translate.stop, agent.spawn, memory.save, memory.recall, reminder.create, reminder.list, reminder.clear, proactive.toggle, system.health, system.help, conversation.reset, diagnostics.show, diagnostics.hide, voice.rate, wake.set, media.status.\n\n${input.localContext ? `Local context:\n${input.localContext}\n\n` : ''}History:\n${input.history
    .slice(-16)
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n')}\n\nUser: ${input.text}`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message ?? 'Gemini request failed.');

  const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part.text).join('\n') ?? '';
  try {
    return sanitizeTurn(JSON.parse(text)) ?? { speech: text, actions: [], intent: 'chat' };
  } catch {
    return { speech: text || 'I am here.', actions: [], intent: 'chat' };
  }
}

export async function translateWithGemini(input: {
  apiKey: string;
  model: string;
  text: string;
  to: string;
  from?: string | null;
}) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `Translate this ${input.from ? `from ${input.from} ` : ''}to ${input.to}. Output only the translation.\n\n${input.text}` }] }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message ?? 'Gemini translation failed.');
  return data?.candidates?.[0]?.content?.parts?.map((part: any) => part.text).join('\n').trim() || input.text;
}
