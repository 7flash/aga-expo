import { MODEL_IDS, PROVIDER_ENDPOINTS } from './modelIds';
import type { Preferences } from '../db/localStore';
import { getPersona } from '../aga/personas';

type BrainInput = {
  text: string;
  prefs: Preferences;
  history: Array<{ role: string; content: string }>;
  memories: Array<{ text: string }>;
};

function buildPrompt({ text, prefs, history, memories }: BrainInput) {
  const persona = getPersona(prefs.persona);
  const memoryBlock = memories.length
    ? `Known memory:\n${memories.map((m) => `- ${m.text}`).join('\n')}`
    : 'Known memory: none yet.';
  const recent = history.slice(-10).map((m) => `${m.role}: ${m.content}`).join('\n');
  return `${persona.system}\n\n${memoryBlock}\n\nRecent conversation:\n${recent}\n\nUser: ${text}\nAGA:`;
}

function extractOpenAIText(data: any) {
  if (typeof data?.output_text === 'string') return data.output_text.trim();
  const text = data?.output
    ?.flatMap((item: any) => item?.content ?? [])
    ?.map((content: any) => content?.text ?? '')
    ?.join('\n')
    ?.trim();
  return text || 'I could not generate a reply.';
}

async function askOpenAI(input: BrainInput) {
  const apiKey = input.prefs.openaiApiKey || process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI key is not set.');
  const response = await fetch(PROVIDER_ENDPOINTS.openaiResponses, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL_IDS.openaiChat,
      input: buildPrompt(input),
      instructions: getPersona(input.prefs.persona).system,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || 'OpenAI request failed.');
  return extractOpenAIText(data);
}

function extractGeminiText(data: any) {
  const blockReason = data?.promptFeedback?.blockReason;
  if (blockReason) {
    throw new Error(`Gemini blocked this request: ${blockReason}.`);
  }

  const candidate = data?.candidates?.[0];
  const finishReason = candidate?.finishReason;
  if (finishReason && !['STOP', 'MAX_TOKENS'].includes(finishReason)) {
    throw new Error(`Gemini could not answer because finishReason=${finishReason}.`);
  }

  const text = candidate?.content?.parts
    ?.map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
    ?.join('\n')
    ?.trim();

  return text || 'I could not generate a reply.';
}

async function askGemini(input: BrainInput) {
  const apiKey = input.prefs.geminiApiKey || process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini key is not set.');
  const url = `${PROVIDER_ENDPOINTS.geminiGenerateContentBase}/${MODEL_IDS.geminiText}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: buildPrompt(input) }] }] }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || 'Gemini request failed.');
  return extractGeminiText(data);
}


export async function askBrain(input: BrainInput) {
  try {
    if (input.prefs.brainMode === 'gemini') return await askGemini(input);
    if (input.prefs.brainMode === 'openai') return await askOpenAI(input);
    throw new Error('offline mode');
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'cloud brain unavailable';
    return `My local voice is working, but my cloud brain is not connected right now. ${reason}`;
  }
}

export async function translatePhrase(text: string, target: string, prefs: Preferences) {
  const prompt = `Translate this phrase to ${target}. Return only the translation.\n\n${text}`;
  return askBrain({ text: prompt, prefs, history: [], memories: [] });
}
