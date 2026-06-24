import type { AgaTurn } from '../aga/actions';
import type { Persona } from '../aga/personas';
import type { ChatMessage } from '../db/schema';
import { getPreferences } from '../db/preferences';
import { measureAsync } from '../aga/measure';
import { askOpenAIDirect } from './openaiDirect';
import { askGeminiDirect } from './geminiDirect';
import { offlineReply } from './offlineBrain';
import { listMemoryFacts } from '../db/memory';
import { listPendingReminders } from '../db/reminders';

export async function askBrain(input: {
  text: string;
  history: ChatMessage[];
  persona: Persona;
}): Promise<AgaTurn> {
  const prefs = await getPreferences();
  const [memories, reminders] = await Promise.all([listMemoryFacts(6), listPendingReminders(6)]);
  const localContext = [
    memories.length ? `Memory notes: ${memories.map((item) => item.text).join(' | ')}` : '',
    reminders.length ? `Pending reminders: ${reminders.map((item) => `${item.title} at ${item.dueAt}`).join(' | ')}` : '',
  ].filter(Boolean).join('\n');

  if (prefs.backendMode === 'gemini-direct' && prefs.geminiApiKey) {
    return measureAsync('brain:gemini-direct', () => askGeminiDirect({
      apiKey: prefs.geminiApiKey!,
      model: prefs.geminiModel,
      text: input.text,
      history: input.history,
      persona: input.persona,
      localContext,
    }));
  }

  if (prefs.backendMode === 'openai-direct' && prefs.openaiApiKey) {
    return measureAsync('brain:openai-direct', () => askOpenAIDirect({
      apiKey: prefs.openaiApiKey!,
      model: prefs.openaiModel,
      text: input.text,
      history: input.history,
      persona: input.persona,
      localContext,
    }));
  }

  return offlineReply(input.text);
}
