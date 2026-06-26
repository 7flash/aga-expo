import { compactEventLogIfIdle, drainDueReminders, listDueAcceptedRoutines, logEvent, markRoutineFired } from '../db/localStore';
import { runLearningConsolidation } from '../learning/consolidation';
import { runSubconsciousSynthesis } from './dreamSynthesis';

export type DreamTickResult = {
  reminders: Array<{ id: number; text: string; dueAt: string }>;
  proactiveSpeech: string[];
  learned?: {
    observed: number;
    proposedRoutines: number;
    promotedMemories: number;
    inferredHabitRoutines?: number;
    observedScenarios?: number;
    subconsciousWritten?: number;
  };
};

/**
 * Idle consolidation loop.
 *
 * It can write durable learning artifacts, but it only speaks due reminders and
 * consent requests. The new subconscious synthesis pass keeps wake context small
 * by storing narrow semantic/procedural/affective facts for later RAG retrieval.
 */
export async function runDreamTick(): Promise<DreamTickResult> {
  const due = await drainDueReminders();
  const proactiveSpeech: string[] = due.map((reminder) => `Reminder: ${reminder.text}`);

  const learned = await runLearningConsolidation().catch(async (error) => {
    await logEvent('dream.learning.error', error instanceof Error ? error.message : String(error || 'learning error')).catch(() => undefined);
    return null;
  });

  const subconscious = await runSubconsciousSynthesis().catch(async (error) => {
    await logEvent('dream.subconscious.error', error instanceof Error ? error.message : String(error || 'subconscious error')).catch(() => undefined);
    return null;
  });

  if (learned?.speech) proactiveSpeech.push(learned.speech);

  const dueRoutines = await listDueAcceptedRoutines(new Date(), 2).catch(() => [] as any[]);
  for (const routine of dueRoutines) {
    proactiveSpeech.push(`I can offer your routine now: ${routine.title}. Say AGA start it, or AGA not now.`);
    await markRoutineFired(routine.id).catch(() => undefined);
  }

  await compactEventLogIfIdle();
  await logEvent(
    'dream.tick',
    `due=${due.length} learned=${learned?.observed ?? 0} routines=${learned?.proposedRoutines ?? 0} subconscious=${subconscious?.written ?? 0}`,
  ).catch(() => undefined);

  return {
    reminders: due,
    proactiveSpeech,
    learned: learned ? {
      observed: learned.observed,
      proposedRoutines: learned.proposedRoutines,
      promotedMemories: learned.promotedMemories,
      inferredHabitRoutines: learned.inferredHabitRoutines,
      observedScenarios: learned.observedScenarios,
      subconsciousWritten: subconscious?.written ?? 0,
    } : subconscious ? {
      observed: 0,
      proposedRoutines: 0,
      promotedMemories: 0,
      subconsciousWritten: subconscious.written,
    } : undefined,
  };
}
