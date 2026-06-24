import { all } from './sqlite';

export type LocalSearchKind = 'message' | 'memory' | 'reminder' | 'media';

export type LocalSearchResult = {
  kind: LocalSearchKind;
  title: string;
  detail: string;
  createdAt: string;
};

function normalizeQuery(query: string) {
  return query
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function termsFor(query: string) {
  return normalizeQuery(query)
    .split(' ')
    .filter((term) => term.length > 2)
    .slice(0, 5);
}

function likeWhere(column: string, count: number) {
  return Array.from({ length: count }, () => `LOWER(${column}) LIKE ?`).join(' OR ');
}

export async function searchLocalRecall(query: string, limit = 12): Promise<LocalSearchResult[]> {
  const terms = termsFor(query);
  if (!terms.length) {
    return all<LocalSearchResult>(
      `SELECT 'message' AS kind, role AS title, content AS detail, createdAt FROM messages
       UNION ALL SELECT 'memory' AS kind, 'Memory' AS title, text AS detail, createdAt FROM memory_facts
       UNION ALL SELECT 'reminder' AS kind, status AS title, title AS detail, dueAt AS createdAt FROM reminders
       UNION ALL SELECT 'media' AS kind, kind AS title, title || ' — ' || query AS detail, updatedAt AS createdAt FROM media_sessions
       ORDER BY createdAt DESC LIMIT ?`,
      [limit]
    );
  }

  const params = terms.map((term) => `%${term}%`);
  const messageWhere = likeWhere('content', terms.length);
  const memoryWhere = likeWhere('text', terms.length);
  const reminderWhere = likeWhere('title', terms.length);
  const mediaWhere = terms.map(() => '(LOWER(title) LIKE ? OR LOWER(query) LIKE ? OR LOWER(COALESCE(artist, \'\')) LIKE ?)').join(' OR ');

  const mediaParams = terms.flatMap((term) => [`%${term}%`, `%${term}%`, `%${term}%`]);

  const [messages, memories, reminders, media] = await Promise.all([
    all<LocalSearchResult>(
      `SELECT 'message' AS kind, role AS title, content AS detail, createdAt FROM messages WHERE ${messageWhere} ORDER BY id DESC LIMIT ?`,
      [...params, limit]
    ),
    all<LocalSearchResult>(
      `SELECT 'memory' AS kind, 'Memory' AS title, text AS detail, createdAt FROM memory_facts WHERE ${memoryWhere} ORDER BY pinned DESC, id DESC LIMIT ?`,
      [...params, limit]
    ),
    all<LocalSearchResult>(
      `SELECT 'reminder' AS kind, status AS title, title AS detail, dueAt AS createdAt FROM reminders WHERE ${reminderWhere} ORDER BY dueAt DESC LIMIT ?`,
      [...params, limit]
    ),
    all<LocalSearchResult>(
      `SELECT 'media' AS kind, kind AS title, title || ' — ' || query AS detail, updatedAt AS createdAt FROM media_sessions WHERE ${mediaWhere} ORDER BY id DESC LIMIT ?`,
      [...mediaParams, limit]
    ),
  ]);

  return [...memories, ...messages, ...reminders, ...media]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

export function summarizeSearchResults(results: LocalSearchResult[], query: string) {
  if (!results.length) return `I could not find local history about ${query}.`;
  const items = results.slice(0, 5).map((item) => `${item.kind}: ${item.detail.replace(/\s+/g, ' ').slice(0, 120)}`);
  return `I found ${results.length} local result${results.length === 1 ? '' : 's'}: ${items.join('; ')}.`;
}
