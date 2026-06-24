import { inferLocalActions } from '../aga/actions';

export type CommandHarnessResult = {
  total: number;
  passed: number;
  failed: { input: string; expected: string; actual: string }[];
};

const FIXTURES: { input: string; expected: string }[] = [
  { input: 'play lofi beats on youtube', expected: 'youtube.play' },
  { input: 'queue chill music', expected: 'media.queue.add' },
  { input: 'play next', expected: 'media.next' },
  { input: 'what is in the queue', expected: 'media.queue.status' },
  { input: 'clear the queue', expected: 'media.queue.clear' },
  { input: 'remind me to stretch in 10 minutes', expected: 'reminder.create' },
  { input: 'turn local notifications on', expected: 'notifications.toggle' },
  { input: 'request notification permission', expected: 'notifications.request' },
  { input: 'remember that I like warm voices', expected: 'memory.save' },
  { input: 'show diagnostics', expected: 'diagnostics.show' },
  { input: 'search history about wake word', expected: 'history.search' },
  { input: 'export local backup', expected: 'backup.export' },
  { input: 'storage summary', expected: 'backup.summary' },
  { input: 'repair yourself', expected: 'system.self_repair' },
];

export function runCommandHarness(): CommandHarnessResult {
  const failed: CommandHarnessResult['failed'] = [];

  for (const fixture of FIXTURES) {
    const turn = inferLocalActions(fixture.input);
    const actual = turn?.actions[0]?.type ?? 'none';
    if (actual !== fixture.expected) failed.push({ input: fixture.input, expected: fixture.expected, actual });
  }

  return { total: FIXTURES.length, passed: FIXTURES.length - failed.length, failed };
}
