import { addSubconsciousFact, logEvent, searchSubconsciousFacts } from '../db/localStore';

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
 * Subconscious facts live outside user-visible memory_facts so recall stays clean.
 * Production can replace the LIKE fallback with sqlite-vss/sqlite-vec without
 * changing the voice router/capability contract.
 */
export async function writeSubconsciousFact(fact: SubconsciousFact) {
  await addSubconsciousFact({
    kind: fact.kind,
    text: fact.text,
    tags: fact.tags ?? [],
    weight: fact.weight ?? 0.5,
    source: fact.source ?? 'reflection',
  });
  await logEvent('subconscious.write', `${fact.kind}: ${fact.text.slice(0, 180)}`).catch(() => undefined);
}

export async function searchSubconscious(query: string, limit = 6, kind?: SubconsciousKind | null): Promise<SubconsciousSearchHit[]> {
  const rows = await searchSubconsciousFacts(query, Math.max(limit * 3, 12), kind).catch(() => [] as any[]);
  return rows
    .map((row: any) => ({
      id: String(row.id || ''),
      kind: (row.kind || 'semantic') as SubconsciousKind,
      text: String(row.text || ''),
      tags: typeof row.tagsJson === 'string' ? JSON.parse(row.tagsJson || '[]') : [],
      weight: Number(row.weight ?? 0.5),
      source: row.source,
      score: overlapScore(query, String(row.text || '')) + Number(row.weight ?? 0.5) * 0.08,
      createdAt: row.createdAt,
    }))
    .filter((hit) => hit.text)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
