import { all, first, run } from './sqlite';
import type { Routine } from './schema';

export async function createRoutine(input: {
  title: string;
  prompt: string;
  timeOfDay: string;
  daysOfWeek?: string | null;
  enabled?: number;
}) {
  const result = await run(
    'INSERT INTO routines (title, prompt, timeOfDay, daysOfWeek, enabled) VALUES (?, ?, ?, ?, ?)',
    [input.title, input.prompt, input.timeOfDay, input.daysOfWeek ?? null, input.enabled ?? 1]
  );
  return first<Routine>('SELECT * FROM routines WHERE id = ?', [(result as any).lastInsertRowId]);
}

export async function listRoutines(limit = 20) {
  return all<Routine>('SELECT * FROM routines ORDER BY enabled DESC, timeOfDay ASC, id DESC LIMIT ?', [limit]);
}

export async function clearRoutines() {
  await run('DELETE FROM routines');
}

export async function setRoutineEnabled(id: number, enabled: boolean) {
  await run('UPDATE routines SET enabled = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [enabled ? 1 : 0, id]);
}

export async function dueRoutines(now = new Date()) {
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const current = `${hh}:${mm}`;
  const weekday = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][now.getDay()];
  const start = new Date(now);
  start.setSeconds(0, 0);
  const windowStart = new Date(start.getTime() - 60_000).toISOString();
  return all<Routine>(
    `SELECT * FROM routines
     WHERE enabled = 1
       AND timeOfDay <= ?
       AND (lastFiredAt IS NULL OR lastFiredAt < ?)
       AND (daysOfWeek IS NULL OR daysOfWeek = '' OR daysOfWeek LIKE ?)
     ORDER BY timeOfDay ASC, id ASC`,
    [current, windowStart, `%${weekday}%`]
  );
}

export async function markRoutineFired(id: number, at = new Date().toISOString()) {
  await run('UPDATE routines SET lastFiredAt = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [at, id]);
}
