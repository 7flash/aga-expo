import type { Role } from './db';

export type LlmMessage = {
  role: Role;
  content: string;
};

function getOutputText(data: any): string {
  if (typeof data.output_text === 'string') return data.output_text.trim();

  const chunks = data.output
    ?.flatMap((item: any) => item.content ?? [])
    ?.filter((content: any) => content.type === 'output_text' && typeof content.text === 'string')
    ?.map((content: any) => content.text);

  return chunks?.join('\n').trim() || 'I could not generate a response.';
}

export async function askAssistant(messages: LlmMessage[]) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-5.5';

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set on the Geeksy TradJS server.');
  }

  const transcript = messages
    .slice(-16)
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
    .join('\n');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      instructions:
        'You are Geeksy, a stylish voice-first AI assistant represented by a futuristic avatar. Be helpful, concise, clear, and natural to hear spoken aloud. Prefer short paragraphs and avoid sounding robotic.',
      input: `Continue this conversation. Keep the answer voice-friendly.\n\n${transcript}\nAssistant:`,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message ?? 'OpenAI request failed.');
  }

  return getOutputText(data);
}
