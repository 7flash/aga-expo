import { all, first } from '../db/sqlite';
import { migrate } from '../db/migrations';
import {
  recordHabitObservation,
  upsertLearnedRoutine,
  upsertScenarioPattern,
} from '../db/localStore';

export type HabitSignal = {
  kind: string;
  label: string;
  confidence?: number;
  context?: Record<string, unknown>;
};

function hourBucket(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:00`;
}

function normalizeKind(kind: string) {
  const clean = String(kind || '').toLowerCase();
  if (/breath|meditat|calm|nervous/.test(clean)) return 'breathing';
  if (/body|sleep|bedtime|wind/.test(clean)) return 'body_scan';
  if (/hypnosis|subconscious|affirm/.test(clean)) return 'self_hypnosis';
  if (/conflict|argument|relationship/.test(clean)) return 'conflict_navigation';
  if (/rain|ocean|forest|music|sound/.test(clean)) return 'music';
  return clean.replace(/[^a-z0-9_]+/g, '_') || 'general';
}

export async function observeHabitSignal(signal: HabitSignal) {
  const kind = normalizeKind(signal.kind);
  const context = { ...(signal.context || {}), hour: hourBucket(), observedAt: new Date().toISOString() };
  await recordHabitObservation({ kind, label: signal.label, context, confidence: signal.confidence ?? 0.55 });
  await upsertScenarioPattern({
    patternKey: `${kind}@${context.hour}`,
    label: `${signal.label} around ${context.hour}`,
    trigger: { kind, approximateHour: context.hour },
    action: { tool: kind === 'music' ? 'soundscape_companion' : 'start_guided_session', args: kind === 'music' ? { query: signal.label } : { kind, goal: signal.label } },
    confidence: signal.confidence ?? 0.55,
    consentState: 'observed',
  });
}

export async function inferHabitRoutines() {
  await migrate();
  const rows = await all<any>(
    `SELECT kind,
            json_extract(contextJson, '$.hour') AS hour,
            COUNT(*) AS count,
            MAX(label) AS label,
            AVG(confidence) AS confidence
       FROM habit_observations
      WHERE createdAt >= datetime('now', '-30 days')
      GROUP BY kind, hour
     HAVING count >= 3
      ORDER BY count DESC, confidence DESC
      LIMIT 8`,
  );

  let proposed = 0;
  for (const row of rows) {
    const kind = normalizeKind(row.kind);
    const hour = String(row.hour || 'any');
    const key = `${kind}@${hour}`;
    const existing = await first<any>(
      `SELECT id FROM routines WHERE triggerJson LIKE ? AND consentState IN ('proposed','accepted') LIMIT 1`,
      [`%${key}%`],
    );
    if (existing) continue;
    const title = kind === 'music'
      ? `Offer soundscape around ${hour}`
      : `Offer ${kind.replace(/_/g, ' ')} around ${hour}`;
    await upsertLearnedRoutine({
      title,
      prompt: `I noticed ${row.count} recent times where ${row.label || kind} helped around ${hour}. Ask for consent before making it automatic.`,
      timeOfDay: hour,
      trigger: { key, kind, approximateHour: hour, observations: Number(row.count || 0) },
      action: { tool: kind === 'music' ? 'soundscape_companion' : 'start_guided_session', args: kind === 'music' ? { query: row.label || 'calm ambient soundscape' } : { kind, goal: 'learned routine' } },
      confidence: Math.min(0.92, Number(row.confidence || 0.55) + Number(row.count || 0) * 0.06),
      consentState: 'proposed',
    });
    proposed += 1;
  }
  return proposed;
}
