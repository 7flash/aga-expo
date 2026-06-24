export const MODEL_IDS = {
  openaiChat: 'gpt-5.5',
  geminiText: 'gemini-2.5-flash',
  geminiLiveTranslate: 'gemini-3.5-live-translate-preview',
} as const;

export type ModelIdKey = keyof typeof MODEL_IDS;

export function normalizeOpenAIModel(model?: string | null) {
  return model?.trim() || MODEL_IDS.openaiChat;
}

export function normalizeGeminiTextModel(model?: string | null) {
  const clean = model?.trim();
  if (!clean || clean === MODEL_IDS.geminiLiveTranslate) return MODEL_IDS.geminiText;
  return clean;
}
