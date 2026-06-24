import { all, first, run } from './sqlite';
import type { ProactiveEvent, Reminder } from './schema';

export async function createReminder(input: { title: string; dueAt: string; source?: Reminder['source']; notificationId?: string | null }) {
  const result = await run('INSERT INTO reminders (title, dueAt, source, notificationId) VALUES (?, ?, ?, ?)', [
    input.title.trim(),
    input.dueAt,
    input.source ?? 'voice',
    input.notificationId ?? null,
  ]);
  return first<Reminder>('SELECT * FROM reminders WHERE id = ?', [result.lastInsertRowId]) as Promise<Reminder>;
}

export async function listPendingReminders(limit = 20) {
  return all<Reminder>('SELECT * FROM reminders WHERE status = ? ORDER BY dueAt ASC LIMIT ?', ['pending', limit]);
}

export async function cancelPendingReminders() {
  await run("UPDATE reminders SET status = 'cancelled', updatedAt = CURRENT_TIMESTAMP WHERE status = 'pending'");
}

export async function markReminderFired(id: number) {
  await run("UPDATE reminders SET status = 'fired', updatedAt = CURRENT_TIMESTAMP WHERE id = ?", [id]);
}

export async function setReminderNotificationId(id: number, notificationId: string | null) {
  await run('UPDATE reminders SET notificationId = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [notificationId, id]);
}

export async function latestPendingReminder() {
  return first<Reminder>('SELECT * FROM reminders WHERE status = ? ORDER BY dueAt ASC LIMIT 1', ['pending']);
}

export async function enqueueProactiveEvent(input: { kind: ProactiveEvent['kind']; speech: string; payload?: unknown }) {
  await run('INSERT INTO proactive_events (kind, speech, payload) VALUES (?, ?, ?)', [
    input.kind,
    input.speech,
    input.payload === undefined ? null : JSON.stringify(input.payload),
  ]);
}

export async function dueReminders(nowIso = new Date().toISOString(), limit = 5) {
  return all<Reminder>('SELECT * FROM reminders WHERE status = ? AND dueAt <= ? ORDER BY dueAt ASC LIMIT ?', ['pending', nowIso, limit]);
}

export async function nextQueuedProactiveEvent() {
  const [event] = await all<ProactiveEvent>('SELECT * FROM proactive_events WHERE status = ? ORDER BY id ASC LIMIT 1', ['queued']);
  return event ?? null;
}

export async function markProactiveEventSpoken(id: number) {
  await run("UPDATE proactive_events SET status = 'spoken', updatedAt = CURRENT_TIMESTAMP WHERE id = ?", [id]);
}

export async function recentProactiveEvents(limit = 8) {
  return all<ProactiveEvent>('SELECT * FROM proactive_events ORDER BY id DESC LIMIT ?', [limit]);
}
