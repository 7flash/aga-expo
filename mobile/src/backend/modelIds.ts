export const MODEL_IDS = {
  openaiChat: process.env.EXPO_PUBLIC_OPENAI_MODEL || 'gpt-5.5',
  geminiText: process.env.EXPO_PUBLIC_GEMINI_MODEL || 'gemini-2.5-flash',
  geminiLiveTranslate: process.env.EXPO_PUBLIC_GEMINI_LIVE_TRANSLATE_MODEL || 'gemini-3.5-live-translate-preview',
} as const;

export const PROVIDER_ENDPOINTS = {
  openaiResponses: 'https://api.openai.com/v1/responses',
  geminiGenerateContentBase: 'https://generativelanguage.googleapis.com/v1beta/models',
} as const;

export function normalizeOpenAIModel(model?: string | null) {
  const clean = model?.trim();
  return clean || MODEL_IDS.openaiChat;
}

export function normalizeGeminiTextModel(model?: string | null) {
  const clean = model?.trim();
  return clean || MODEL_IDS.geminiText;
}
