import type { AgaTurn } from '../aga/actions';
import type { Persona } from '../aga/personas';
import type { ChatMessage } from '../db/schema';
import { getPreferences } from '../db/preferences';
import { measureAsync } from '../aga/measure';
import { askOpenAIDirect } from './openaiDirect';
import { askGeminiDirect } from './geminiDirect';
import { offlineReply } from './offlineBrain';

export async function askBrain(input: {
  text: string;
  history: ChatMessage[];
  persona: Persona;
}): Promise<AgaTurn> {
  const prefs = await getPreferences();

  if (prefs.backendMode === 'gemini-direct' && prefs.geminiApiKey) {
    return measureAsync('brain:gemini-direct', () => askGeminiDirect({
      apiKey: prefs.geminiApiKey!,
      model: prefs.geminiModel,
      text: input.text,
      history: input.history,
      persona: input.persona,
    }));
  }

  if (prefs.backendMode === 'openai-direct' && prefs.openaiApiKey) {
    return measureAsync('brain:openai-direct', () => askOpenAIDirect({
      apiKey: prefs.openaiApiKey!,
      model: prefs.openaiModel,
      text: input.text,
      history: input.history,
      persona: input.persona,
    }));
  }

  return offlineReply(input.text);
}
