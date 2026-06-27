import { getPersona } from '../aga/personas';
import type { Preferences } from '../db/localStore';

type BrainInput = {
  text: string;
  prefs: Preferences;
  history: Array<{ role: string; content: string }>;
  memories: Array<{ text: string }>;
};

function env(name: string) {
  return process.env?.[name] ?? '';
}

function buildPrompt(input: BrainInput) {
  const persona = getPersona(input.prefs.persona);
  const memories = input.memories.length
    ? input.memories.map((memory) => `- ${memory.text}`).join('
')
    : 'none';
  const history = input.history.slice(-12).map((message) => `${message.role}: ${message.content}`).join('
');
  return `${persona.systemPrompt}

Known memories:
${memories}

Recent conversation:
${history || 'none'}

User: ${input.text}
AGA:`;
}

function fallbackReply(text: string) {
  const lower = text.toLowerCase();
  if (/\b(advice|help|what should i do)\b/.test(lower)) {
    return 'I am here. Take one calm breath, name the next small step, and I will help you move through it.';
  }
  if (/\b(are you there|can you hear|where are you|hello|hi)\b/.test(lower)) {
    return 'I am here, listening and ready to help.';
  }
  return `I heard you. My local brain is running, but the cloud brain is not connected yet. You said: ${text}`;
}

function extractOpenAIText(data: any) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  const text = data?.output
    ?.flatMap((item: any) => item?.content ?? [])
    ?.map((content: any) => content?.text ?? content?.transcript ?? '')
    ?.join('
')
    ?.trim();
  return text || '';
}

async function askOpenAI(input: BrainInput) {
  const apiKey = input.prefs.openaiApiKey || env('EXPO_PUBLIC_OPENAI_API_KEY');
  if (!apiKey) return fallbackReply(input.text);
  const model = env('EXPO_PUBLIC_OPENAI_MODEL') || 'gpt-5.5';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      instructions: getPersona(input.prefs.persona).systemPrompt,
      input: buildPrompt(input),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || 'OpenAI request failed.');
  return extractOpenAIText(data) || fallbackReply(input.text);
}

async function askGemini(input: BrainInput) {
  const apiKey = input.prefs.geminiApiKey || env('EXPO_PUBLIC_GEMINI_API_KEY');
  if (!apiKey) return fallbackReply(input.text);
  const model = env('EXPO_PUBLIC_GEMINI_MODEL') || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: buildPrompt(input) }] }] }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || 'Gemini request failed.');
  return data?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text ?? '').join('
').trim() || fallbackReply(input.text);
}

export async function askBrain(input: BrainInput) {
  try {
    if (input.prefs.brainMode === 'gemini') return await askGemini(input);
    if (input.prefs.brainMode === 'offline') return fallbackReply(input.text);
    return await askOpenAI(input);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'cloud brain unavailable';
    return `I am here, but my cloud brain hit a glitch: ${reason}`;
  }
}

export async function translatePhrase(text: string, target: string, prefs: Preferences) {
  const reply = await askBrain({
    text: `Translate this phrase to ${target}. Return only the translation.

${text}`,
    prefs,
    history: [],
    memories: [],
  });
  return reply.trim() || text;
}