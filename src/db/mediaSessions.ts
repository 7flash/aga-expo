import { all, first, run } from './sqlite';
import type { MediaSession } from './schema';

export async function saveMediaSession(input: {
  kind: MediaSession['kind'];
  title: string;
  artist?: string | null;
  query: string;
  ref?: string | null;
  artworkUrl?: string | null;
  state?: MediaSession['state'];
}) {
  const result = await run(
    `INSERT INTO media_sessions (kind, title, artist, query, ref, artworkUrl, state)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.kind,
      input.title,
      input.artist ?? null,
      input.query,
      input.ref ?? null,
      input.artworkUrl ?? null,
      input.state ?? 'playing',
    ]
  );
  return first<MediaSession>('SELECT * FROM media_sessions WHERE id = ?', [result.lastInsertRowId]) as Promise<MediaSession>;
}

export async function updateLatestMediaState(kind: MediaSession['kind'] | 'all', state: MediaSession['state']) {
  if (kind === 'all') {
    await run(`UPDATE media_sessions SET state = ?, updatedAt = CURRENT_TIMESTAMP WHERE id IN (
      SELECT id FROM media_sessions ORDER BY id DESC LIMIT 2
    )`, [state]);
    return;
  }

  await run(`UPDATE media_sessions SET state = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = (
    SELECT id FROM media_sessions WHERE kind = ? ORDER BY id DESC LIMIT 1
  )`, [state, kind]);
}

export async function latestMediaSession() {
  return first<MediaSession>('SELECT * FROM media_sessions ORDER BY id DESC LIMIT 1');
}

export async function recentMediaSessions(limit = 12) {
  return all<MediaSession>('SELECT * FROM media_sessions ORDER BY id DESC LIMIT ?', [limit]);
}
