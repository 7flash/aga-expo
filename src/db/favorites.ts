import { all, first, run } from './sqlite';
import type { MediaFavorite } from './schema';

export async function saveMediaFavorite(input: {
  kind: 'youtube' | 'music';
  title: string;
  artist?: string | null;
  query: string;
  ref?: string | null;
  artworkUrl?: string | null;
}) {
  const existing = await first<MediaFavorite>(
    'SELECT * FROM media_favorites WHERE kind = ? AND COALESCE(ref, query) = COALESCE(?, ?) LIMIT 1',
    [input.kind, input.ref ?? null, input.query]
  );
  if (existing) {
    await run('UPDATE media_favorites SET title = ?, artist = ?, artworkUrl = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [
      input.title,
      input.artist ?? null,
      input.artworkUrl ?? null,
      existing.id,
    ]);
    return first<MediaFavorite>('SELECT * FROM media_favorites WHERE id = ?', [existing.id]);
  }

  const result = await run(
    'INSERT INTO media_favorites (kind, title, artist, query, ref, artworkUrl) VALUES (?, ?, ?, ?, ?, ?)',
    [input.kind, input.title, input.artist ?? null, input.query, input.ref ?? null, input.artworkUrl ?? null]
  );
  return first<MediaFavorite>('SELECT * FROM media_favorites WHERE id = ?', [(result as any).lastInsertRowId]);
}

export async function listMediaFavorites(limit = 12) {
  return all<MediaFavorite>('SELECT * FROM media_favorites ORDER BY updatedAt DESC, id DESC LIMIT ?', [limit]);
}

export async function searchMediaFavorites(query = '', limit = 8) {
  const term = `%${query.trim()}%`;
  if (!query.trim()) return listMediaFavorites(limit);
  return all<MediaFavorite>(
    'SELECT * FROM media_favorites WHERE title LIKE ? OR artist LIKE ? OR query LIKE ? ORDER BY updatedAt DESC, id DESC LIMIT ?',
    [term, term, term, limit]
  );
}

export async function clearMediaFavorites() {
  await run('DELETE FROM media_favorites');
}
