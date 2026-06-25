import { toolCallToAction } from './tools';

const CASES = [
  { name: 'add_reminder', arguments: { text: 'stretch', dueAt: '2030-01-01T09:00:00.000Z' }, type: 'add_reminder' },
  { name: 'save_memory', arguments: { text: 'user likes calm voice' }, type: 'remember' },
  { name: 'play_youtube', arguments: { query: 'lofi piano' }, type: 'play_youtube' },
  { name: 'media_control', arguments: { command: 'pause' }, type: 'media_pause' },
  { name: 'request_notifications', arguments: {}, type: 'request_notifications' },
  { name: 'translate_start', arguments: { target: 'Indonesian' }, type: 'translate_start' },
];

export function assertAgaToolQa() {
  const failures: string[] = [];
  for (const item of CASES) {
    const action = toolCallToAction({ name: item.name, arguments: item.arguments });
    if (!action || action.type !== item.type) failures.push(`${item.name} expected ${item.type}, got ${action?.type ?? 'null'}`);
  }
  if (failures.length) throw new Error(`AGA tool QA failed: ${failures.join('; ')}`);
  return true;
}
