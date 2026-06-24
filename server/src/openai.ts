import { getAssistantPreferences, type Role } from './db';
import { measured } from './measure';

export type LlmMessage = {
  role: Role;
  content: string;
};

export type StructuredTurnOptions = {
  command: string;
  deterministicIntent: string;
  personaPrompt: string;
  allowActions?: boolean;
};

export type StructuredTurn = {
  speech: string;
  actions: unknown[];
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

function parseStructuredJson(text: string): StructuredTurn {
  const trimmed = text.trim();
  const jsonCandidate = trimmed.startsWith('{')
    ? trimmed
    : trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() ?? trimmed.match(/\{[\s\S]*\}/)?.[0] ?? '';

  if (!jsonCandidate) return { speech: trimmed, actions: [] };

  try {
    const data = JSON.parse(jsonCandidate);
    return {
      speech: typeof data.speech === 'string' ? data.speech.trim() : trimmed,
      actions: Array.isArray(data.actions) ? data.actions : [],
    };
  } catch {
    return { speech: trimmed, actions: [] };
  }
}

async function callResponsesAPI(input: Record<string, unknown>) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-5.5';

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set on the AGA TradJS server.');
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, ...input }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message ?? 'OpenAI request failed.');
  }

  return data;
}

export async function askAssistant(messages: LlmMessage[]) {
  return measured('openai.askAssistant', async () => {
    const preferences = getAssistantPreferences();

    if (!process.env.OPENAI_API_KEY) {
      return 'I am running locally, but OPENAI_API_KEY is not set on the AGA TradJS server yet. I can still handle local voice commands like music, YouTube setup checks, translation fallback, preferences, and diagnostics.';
    }

    const transcript = messages
      .slice(-18)
      .map((message) => `${message.role === 'user' ? 'User' : preferences.assistantName}: ${message.content}`)
      .join('\n');

    const data = await callResponsesAPI({
      instructions: [
        `You are ${preferences.assistantName}, a feminine voice-first AI assistant and the friendly counterpart to Geeksy.`,
        'The device is voice-only. Never rely on taps, keyboard shortcuts, or visual-only instructions unless there is no alternative.',
        'Be concise enough to hear aloud, but keep context and continuity from the conversation history.',
        'When the user asks for app/device actions, explain what you can do and what needs to be configured.',
        'For complex tasks, describe a safe agentic plan and ask for confirmation before irreversible external actions.',
        `Voice style: ${styleHint(preferences.voiceStyle)}.`,
      ].join('\n'),
      input: `Continue this conversation. Keep the answer voice-friendly and reliable.\n\n${transcript}\n${preferences.assistantName}:`,
    });

    return getOutputText(data);
  });
}

export async function askAssistantTurn(messages: LlmMessage[], options: StructuredTurnOptions): Promise<StructuredTurn> {
  return measured('openai.askAssistantTurn', async () => {
    const preferences = getAssistantPreferences();

    if (!process.env.OPENAI_API_KEY) {
      return {
        speech:
          options.deterministicIntent === 'chat'
            ? 'I am running locally, but OPENAI_API_KEY is not set yet. I can still control local media, translation mode, settings, and diagnostics.'
            : '',
        actions: [],
      };
    }

    const transcript = messages
      .slice(-18)
      .map((message) => `${message.role === 'user' ? 'User' : preferences.assistantName}: ${message.content}`)
      .join('\n');

    const allowedActions = options.allowActions
      ? [
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
          'conversation.reset',
        ].join(', ')
      : 'Only use [] unless an action is absolutely necessary.';

    const data = await callResponsesAPI({
      instructions: [
        `You are ${preferences.assistantName}, AGA: a warm, supportive, wise feminine voice companion.`,
        options.personaPrompt,
        'This is a voice-only device. Every response must be safe to hear aloud and must never depend on touch input.',
        'Return ONLY valid JSON, with no markdown and no extra text.',
        'Schema: { "speech": string, "actions": Array<{ "type": string, "payload": object, "confidence"?: number, "spokenSummary"?: string }> }.',
        `Allowed action types: ${allowedActions}`,
        'For ordinary conversation, return actions: []. For device/media/config requests, use structured actions and a short spoken confirmation.',
        'Prefer reliability over cleverness. If uncertain, ask one short clarifying question in speech and use no action.',
      ].join('\n'),
      input: [
        `Detected deterministic intent: ${options.deterministicIntent}`,
        `Latest command: ${options.command}`,
        '',
        'Recent conversation:',
        transcript || '(no previous messages)',
      ].join('\n'),
    });

    return parseStructuredJson(getOutputText(data));
  });
}
