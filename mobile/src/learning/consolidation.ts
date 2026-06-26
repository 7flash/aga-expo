import { all, first, run } from '../db/sqlite';
import { migrate } from '../db/migrations';
import { addMemory, listProposedRoutines, upsertLearnedRoutine } from '../db/localStore';

export type ConsolidationResult = {
  observed: number;
  proposedRoutines: number;
  promotedMemories: number;
  speech?: string | null;
};

function hourFromIso(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${String(date.getHours()).padStart(2, '0')}:00`;
}

function likelyRoutineKind(text: string) {
  const lower = text.toLowerCase();
  if (/breath|breathe|breathing|meditat|calm|nervous system/.test(lower)) return 'breathing';
  if (/body scan|relax|sleep|bedtime/.test(lower)) return 'body_scan';
  if (/hypnosis|subconscious|affirmation/.test(lower)) return 'self_hypnosis';
  if (/conflict|argument|fight|relationship/.test(lower)) return 'conflict_navigation';
  if (/rain|ocean|music|lofi|lo-fi|ambient/.test(lower)) return 'music';
  return null;
}

function routineTitle(kind: string, hour: string) {
  const label = kind === 'body_scan' ? 'body scan' : kind.replace(/_/g, ' ');
  return `Offer ${label} around ${hour}`;
}

async function proposeRoutinesFromEvents() {
  try {
    await migrate();
    const rows = await all<{ label: string; payload: string | null; createdAt: string }>(
      `SELECT label, payload, createdAt
         FROM event_log
        WHERE createdAt >= datetime('now', '-21 days')
          AND (label LIKE '%guided_session.start%' OR label LIKE '%ambient.play%' OR label LIKE '%youtube.play%')
        ORDER BY createdAt DESC
        LIMIT 240`,
    );
    const buckets = new Map<string, { count: number; kind: string; hour: string; examples: string[] }>();
    for (const row of rows) {
      const text = `${row.label} ${row.payload ?? ''}`;
      const kind = likelyRoutineKind(text);
      const hour = hourFromIso(row.createdAt);
      if (!kind || !hour) continue;
      const key = `${kind}@${hour}`;
      const bucket = buckets.get(key) ?? { count: 0, kind, hour, examples: [] };
      bucket.count += 1;
      if (bucket.examples.length < 3) bucket.examples.push(text.slice(0, 160));
      buckets.set(key, bucket);
    }

    let proposed = 0;
    for (const bucket of buckets.values()) {
      if (bucket.count < 3) continue;
      const existing = await first<{ id: number }>(
        `SELECT id FROM routines WHERE triggerJson LIKE ? AND consentState IN ('proposed', 'accepted') LIMIT 1`,
        [`%${bucket.kind}%${bucket.hour}%`],
      );
      if (existing) continue;
      await upsertLearnedRoutine({
        title: routineTitle(bucket.kind, bucket.hour),
        prompt: `I noticed this pattern: ${bucket.examples.join(' | ')}. Ask whether to make it a routine before acting automatically.`,
        timeOfDay: bucket.hour,
        trigger: { kind: bucket.kind, approximateHour: bucket.hour, minObservations: bucket.count },
        action: { tool: 'start_guided_session', args: { kind: bucket.kind, goal: 'learned routine' } },
        confidence: Math.min(0.92, 0.45 + bucket.count * 0.1),
        consentState: 'proposed',
      });
      proposed += 1;
    }
    return proposed;
  } catch {
    return 0;
  }
}

async function promoteReflectionsToMemory() {
  try {
    await migrate();
    const rows = await all<any>(
      `SELECT * FROM episodic_reflections
        WHERE createdAt >= datetime('now', '-30 days')
        ORDER BY createdAt DESC
        LIMIT 30`,
    );
    let promoted = 0;
    for (const row of rows) {
      const technique = String(row.technique || '').trim();
      const pattern = String(row.emotionalPattern || '').trim();
      const ritual = String(row.nextRitual || '').trim();
      if (technique) {
        await addMemory(`Helpful technique: ${technique}`, { kind: 'effective_technique', source: 'reflection', confidence: 0.75 });
        promoted += 1;
      }
      if (pattern) {
        await addMemory(`Emotional pattern to support gently: ${pattern}`, { kind: 'emotional_pattern', source: 'reflection', confidence: 0.68 });
        promoted += 1;
      }
      if (ritual) {
        await addMemory(`Useful next ritual: ${ritual}`, { kind: 'routine', source: 'reflection', confidence: 0.7 });
        promoted += 1;
      }
    }
    return Math.min(promoted, 12);
  } catch {
    return 0;
  }
}

export async function runLearningConsolidation(): Promise<ConsolidationResult> {
  const [proposedRoutines, promotedMemories] = await Promise.all([
    proposeRoutinesFromEvents(),
    promoteReflectionsToMemory(),
  ]);
  const proposed = await listProposedRoutines(1).catch(() => [] as any[]);
  const top = proposed[0];
  const speech = top
    ? `I noticed a possible helpful routine: ${top.title}. Say AGA make that a routine, or AGA ignore that routine.`
    : null;
  await run('PRAGMA optimize').catch(() => undefined);
  return {
    observed: proposedRoutines + promotedMemories,
    proposedRoutines,
    promotedMemories,
    speech,
  };
}
