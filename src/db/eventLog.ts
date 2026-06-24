import { all, run } from './sqlite';
import type { EventLog } from './schema';

export async function logEvent(kind: string, label: string, payload?: unknown, durationMs?: number | null) {
  await run('INSERT INTO event_log (kind, label, payload, durationMs) VALUES (?, ?, ?, ?)', [
    kind,
    label,
    payload === undefined ? null : JSON.stringify(payload),
    durationMs ?? null,
  ]);
}

export async function recentEvents(limit = 50): Promise<EventLog[]> {
  return all<EventLog>('SELECT * FROM event_log ORDER BY id DESC LIMIT ?', [limit]);
}
