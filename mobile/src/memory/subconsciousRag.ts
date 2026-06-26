import { searchMemories, addMemory, logEvent } from '../db/localStore';

export type SubconsciousContext = {
  query: string;
  memories: string[];
  promptBlock: string;
};

function keywords(text: string) {
  return String(text || '').toLowerCase().split(/[^a-z0-9а-яё]+/i).filter((w) => w.length > 3).slice(0, 8);
}

export async function subconsciousRecall(query: string, limit = 5): Promise<SubconsciousContext> {
  const clean = String(query || '').trim();
  const terms = keywords(clean);
  const found = await searchMemories(terms.join(' ') || clean || undefined, limit).catch(() => []);
  const memories = found.map((m: any) => String(m.text || '')).filter(Boolean).slice(0, limit);
  const promptBlock = memories.length
    ? ['Relevant subconscious memory. Use only if helpful:', ...memories.map((m) => `- ${m}`)].join('\n')
    : 'No relevant subconscious memory found.';
  return { query: clean, memories, promptBlock };
}

export async function consolidateObservedPattern(note: string) {
  const clean = String(note || '').trim();
  if (!clean) return null;
  await addMemory(`Observed pattern: ${clean}`);
  await logEvent('memory.subconscious.pattern', clean).catch(() => undefined);
  return clean;
}
