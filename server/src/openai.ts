import { getAssistantPreferences, type Role } from './db';
import { measured } from './measure';

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

function styleHint(style: string) {
  switch (style) {
    case 'bright':
      return 'sound upbeat, energetic, and reassuring';
    case 'calm':
      return 'sound calm, slow, and grounding';
    case 'coach':
      return 'sound like a practical coach with clear next steps';
    case 'story':
      return 'sound vivid, expressive, and friendly';
    default:
      return 'sound warm, feminine, friendly, and supportive';
  }
}

export async function askAssistant(messages: LlmMessage[]) {
  return measured('openai.askAssistant', async () => {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || 'gpt-5.5';
    const preferences = getAssistantPreferences();

    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set on the AGA TradJS server.');
    }

    const transcript = messages
      .slice(-18)
      .map((message) => `${message.role === 'user' ? 'User' : preferences.assistantName}: ${message.content}`)
      .join('\n');

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        instructions: [
          `You are ${preferences.assistantName}, a feminine voice-first AI assistant and the friendly counterpart to Geeksy.`,
          'The device is voice-only. Never rely on taps, keyboard shortcuts, or visual-only instructions unless there is no alternative.',
          'Be concise enough to hear aloud, but keep context and continuity from the conversation history.',
          'When the user asks for app/device actions, explain what you can do and what needs to be configured.',
          `Voice style: ${styleHint(preferences.voiceStyle)}.`,
        ].join('\n'),
        input: `Continue this conversation. Keep the answer voice-friendly and reliable.\n\n${transcript}\n${preferences.assistantName}:`,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error?.message ?? 'OpenAI request failed.');
    }

    return getOutputText(data);
  });
}
