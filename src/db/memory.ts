import { all, run } from './sqlite';
import type { MemoryFact } from './schema';

function normalize(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export async function saveMemoryFact(text: string, source: MemoryFact['source'] = 'voice') {
  const clean = normalize(text);
  if (!clean) return null;
  await run('INSERT INTO memory_facts (text, source) VALUES (?, ?)', [clean, source]);
  const [created] = await all<MemoryFact>('SELECT * FROM memory_facts ORDER BY id DESC LIMIT 1');
  return created ?? null;
}

export async function listMemoryFacts(limit = 12) {
  return all<MemoryFact>('SELECT * FROM memory_facts ORDER BY pinned DESC, id DESC LIMIT ?', [limit]);
}

export async function searchMemoryFacts(query: string, limit = 8) {
  const clean = normalize(query).toLowerCase();
  if (!clean) return listMemoryFacts(limit);
  const words = clean.split(' ').filter((word) => word.length > 2).slice(0, 5);
  if (!words.length) return listMemoryFacts(limit);
  const where = words.map(() => 'LOWER(text) LIKE ?').join(' OR ');
  return all<MemoryFact>(`SELECT * FROM memory_facts WHERE ${where} ORDER BY pinned DESC, id DESC LIMIT ?`, [
    ...words.map((word) => `%${word}%`),
    limit,
  ]);
}

export async function clearMemoryFacts() {
  await run('DELETE FROM memory_facts');
}
