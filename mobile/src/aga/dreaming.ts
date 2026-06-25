import type { AgaMode } from './turn';

export type DreamInput = {
  mode: AgaMode;
  proactiveEnabled: boolean;
  pendingReminders: Array<{ text: string; dueAt: string }>;
  recentMessages: Array<{ role: string; content: string; createdAt?: string }>;
  now?: Date;
};

export type DreamOutput = {
  shouldCompactLogs: boolean;
  labels: string[];
  manifestation: string | null;
};

function hourOf(date: Date) {
  return date.getHours();
}

function isNightIdle(date: Date, mode: AgaMode) {
  const hour = hourOf(date);
  return (hour >= 23 || hour <= 5) && (mode === 'sleeping' || mode === 'listening');
}

function soonestReminder(input: DreamInput) {
  const now = (input.now ?? new Date()).getTime();
  return input.pendingReminders
    .map((reminder) => ({ reminder, ms: Date.parse(reminder.dueAt) - now }))
    .filter((item) => Number.isFinite(item.ms) && item.ms > 0)
    .sort((a, b) => a.ms - b.ms)[0] ?? null;
}

/**
 * Lightweight proactive cognition. Heavy LLM summarization can be attached here
 * later, but this first phase keeps the device reliable and privacy-preserving.
 */
export function runDreamTick(input: DreamInput): DreamOutput {
  if (!input.proactiveEnabled) return { shouldCompactLogs: false, labels: ['dream.disabled'], manifestation: null };

  const now = input.now ?? new Date();
  const labels: string[] = [];
  let manifestation: string | null = null;

  if (isNightIdle(now, input.mode)) labels.push('dream.night_idle');
  if (input.recentMessages.length > 12) labels.push('dream.context_rich');

  const soon = soonestReminder(input);
  if (soon && soon.ms <= 10 * 60_000) {
    labels.push('dream.reminder_soon');
    manifestation = `A reminder is coming soon: ${soon.reminder.text}.`;
  }

  return {
    shouldCompactLogs: isNightIdle(now, input.mode) || labels.includes('dream.context_rich'),
    labels: labels.length ? labels : ['dream.idle'],
    manifestation,
  };
}
