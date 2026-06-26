import { addMemory, logEvent, searchMemories } from '../db/localStore';

export type SubconsciousKind = 'semantic' | 'episodic' | 'procedural' | 'affective' | 'skill' | 'routine';

export type SubconsciousFact = {
  id?: string;
  kind: SubconsciousKind;
  text: string;
  tags?: string[];
  weight?: number;
  source?: 'reflection' | 'dream' | 'user_taught' | 'routine' | 'session';
  createdAt?: string;
};

export type SubconsciousSearchHit = SubconsciousFact & { score: number };

function tokenize(text: string) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9а-яёіїєґñáéíóúü\s-]/gi, ' ').split(/\s+/).filter((word) => word.length > 2);
}

function overlapScore(query: string, text: string) {
  const q = new Set(tokenize(query));
  if (!q.size) return 0;
  const words = tokenize(text);
  let score = 0;
  for (const word of words) if (q.has(word)) score += 1;
  return score / Math.max(1, q.size);
}

/**
 * Vector-ready subconscious store facade.
 *
 * Production can replace the fallback with sqlite-vss/sqlite-vec. The API keeps
 * context retrieval narrow: wake prompt in, only relevant memories out.
 */
export async function writeSubconsciousFact(fact: SubconsciousFact) {
  const text = `[${fact.kind}] ${fact.text}${fact.tags?.length ? ` #${fact.tags.join(' #')}` : ''}`;
  await addMemory(text);
  await logEvent('subconscious.write', `${fact.kind}: ${fact.text.slice(0, 180)}`).catch(() => undefined);
}

export async function searchSubconscious(query: string, limit = 6): Promise<SubconsciousSearchHit[]> {
  const memories = await searchMemories(query, Math.max(limit * 3, 12)).catch(() => [] as any[]);
  return memories
    .map((memory: any) => {
      const text = String(memory.text || '');
      const match = text.match(/^\[([^\]]+)\]\s*(.*)$/);
      const kind = (match?.[1] || 'semantic') as SubconsciousKind;
      const clean = match?.[2] || text;
      return { kind, text: clean, score: overlapScore(query, clean), createdAt: memory.createdAt } as SubconsciousSearchHit;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function subconsciousContextBlock(query: string, limit = 5) {
  const hits = await searchSubconscious(query, limit);
  const useful = hits.filter((hit) => hit.score > 0 || hit.kind === 'procedural' || hit.kind === 'affective');
  if (!useful.length) return '';
  return [
    'Relevant subconscious memory, retrieved for this wake prompt only:',
    ...useful.map((hit) => `- (${hit.kind}) ${hit.text}`),
  ].join('\n');
}
