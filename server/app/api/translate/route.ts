import { z } from 'sqlite-zod-orm';
import { getAssistantPreferences } from '../../../src/db';
import { measured } from '../../../src/measure';

const translateRequestSchema = z.object({
  text: z.string().trim().min(1).max(2_000),
  targetLanguage: z.string().trim().min(2).max(40).optional(),
  sourceLanguage: z.string().trim().min(2).max(40).optional(),
  style: z.enum(['natural', 'literal', 'polite']).optional().default('natural'),
});

function extractGeminiText(data: any) {
  return (
    data?.candidates?.[0]?.content?.parts
      ?.map((part: any) => (typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim() || ''
  );
}

function extractOpenAiText(data: any) {
  if (typeof data.output_text === 'string') return data.output_text.trim();

  return (
    data.output
      ?.flatMap((item: any) => item.content ?? [])
      ?.filter((content: any) => content.type === 'output_text' && typeof content.text === 'string')
      ?.map((content: any) => content.text)
      ?.join('\n')
      ?.trim() || ''
  );
}

function buildPrompt(text: string, targetLanguage: string, sourceLanguage: string, style: string) {
  const styleHint =
    style === 'literal'
      ? 'Translate as literally as possible while remaining understandable.'
      : style === 'polite'
        ? 'Translate naturally and politely.'
        : 'Translate naturally for live spoken conversation.';

  return [
    `Source language: ${sourceLanguage}.`,
    `Target language: ${targetLanguage}.`,
    styleHint,
    'Return only the translation. Do not explain.',
    '',
    text,
  ].join('\n');
}

async function translateWithGemini(prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.15, maxOutputTokens: 800 },
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error?.message ?? 'Gemini translation failed.');
  }

  return extractGeminiText(data);
}

async function translateWithOpenAi(prompt: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5.5',
      instructions: 'You are a live interpreter. Return only the translation.',
      input: prompt,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error?.message ?? 'OpenAI translation failed.');
  }

  return extractOpenAiText(data);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = translateRequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid translation request.' },
      { status: 400 }
    );
  }

  return measured('translate.segment', async () => {
    const preferences = getAssistantPreferences();
    const targetLanguage = parsed.data.targetLanguage ?? preferences.translationTarget;
    const sourceLanguage = parsed.data.sourceLanguage ?? preferences.translationSource;
    const prompt = buildPrompt(parsed.data.text, targetLanguage, sourceLanguage, parsed.data.style);

    const provider = process.env.GEMINI_API_KEY ? 'gemini' : process.env.OPENAI_API_KEY ? 'openai' : 'offline';
    const translated =
      (await translateWithGemini(prompt)) ??
      (await translateWithOpenAi(prompt)) ??
      parsed.data.text;

    return Response.json({
      provider,
      sourceLanguage,
      targetLanguage,
      original: parsed.data.text,
      translated,
      liveModelHint: process.env.GEMINI_TRANSLATE_MODEL || 'gemini-3.5-live-translate-preview',
    });
  });
}
