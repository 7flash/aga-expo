import { all, first, run } from './sqlite';
import type { MediaQueueItem } from './schema';

export async function enqueueMedia(input: {
  kind: MediaQueueItem['kind'];
  query: string;
  title?: string | null;
  artist?: string | null;
  ref?: string | null;
  artworkUrl?: string | null;
}) {
  const [{ nextOrder } = { nextOrder: 1 }] = await all<{ nextOrder: number }>('SELECT COALESCE(MAX(sortOrder), 0) + 1 AS nextOrder FROM media_queue');
  const result = await run(
    `INSERT INTO media_queue (kind, query, title, artist, ref, artworkUrl, sortOrder)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [input.kind, input.query, input.title ?? null, input.artist ?? null, input.ref ?? null, input.artworkUrl ?? null, nextOrder]
  );
  return first<MediaQueueItem>('SELECT * FROM media_queue WHERE id = ?', [result.lastInsertRowId]) as Promise<MediaQueueItem>;
}

export async function listQueuedMedia(limit = 12) {
  return all<MediaQueueItem>(
    "SELECT * FROM media_queue WHERE status IN ('queued', 'playing') ORDER BY sortOrder ASC, id ASC LIMIT ?",
    [limit]
  );
}

export async function nextQueuedMedia() {
  return first<MediaQueueItem>("SELECT * FROM media_queue WHERE status = 'queued' ORDER BY sortOrder ASC, id ASC LIMIT 1");
}

export async function markQueueItem(id: number, status: MediaQueueItem['status'], patch: Partial<Pick<MediaQueueItem, 'title' | 'artist' | 'ref' | 'artworkUrl'>> = {}) {
  await run(
    `UPDATE media_queue
     SET status = ?, title = COALESCE(?, title), artist = COALESCE(?, artist), ref = COALESCE(?, ref), artworkUrl = COALESCE(?, artworkUrl), updatedAt = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [status, patch.title ?? null, patch.artist ?? null, patch.ref ?? null, patch.artworkUrl ?? null, id]
  );
}

export async function clearMediaQueue() {
  await run("UPDATE media_queue SET status = 'cleared', updatedAt = CURRENT_TIMESTAMP WHERE status IN ('queued', 'playing')");
}

export async function countQueuedMedia() {
  const row = await first<{ count: number }>("SELECT COUNT(*) AS count FROM media_queue WHERE status IN ('queued', 'playing')");
  return Number(row?.count ?? 0);
}
