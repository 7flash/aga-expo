import { compactEventLogIfIdle, drainDueReminders, logEvent } from '../db/localStore';
import { runLearningConsolidation } from '../learning/consolidation';

export type DreamTickResult = {
  reminders: Array<{ id: number; text: string; dueAt: string }>;
  proactiveSpeech: string[];
  learned?: {
    observed: number;
    proposedRoutines: number;
    promotedMemories: number;
  };
};

/**
 * Idle consolidation loop.
 *
 * This is deliberately allowed to write durable learning artifacts. It still
 * does not speak unsolicited advice except due reminders or consent requests
 * for learned routines. That keeps AGA evolving without becoming intrusive.
 */
export async function runDreamTick(): Promise<DreamTickResult> {
  const due = await drainDueReminders();
  const proactiveSpeech: string[] = due.map((reminder) => `Reminder: ${reminder.text}`);

  const learned = await runLearningConsolidation().catch(async (error) => {
    await logEvent('dream.learning.error', error instanceof Error ? error.message : String(error || 'learning error')).catch(() => undefined);
    return null;
  });

  if (learned?.speech) proactiveSpeech.push(learned.speech);

  await compactEventLogIfIdle();
  await logEvent(
    'dream.tick',
    `due=${due.length} learned=${learned?.observed ?? 0} routines=${learned?.proposedRoutines ?? 0}`,
  ).catch(() => undefined);

  return {
    reminders: due,
    proactiveSpeech,
    learned: learned ? {
      observed: learned.observed,
      proposedRoutines: learned.proposedRoutines,
      promotedMemories: learned.promotedMemories,
    } : undefined,
  };
}
