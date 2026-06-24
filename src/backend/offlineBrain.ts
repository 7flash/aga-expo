import type { AgaTurn } from '../aga/actions';

export function offlineReply(text: string): AgaTurn {
  const lower = text.toLowerCase();
  if (lower.includes('hello') || lower.includes('hi')) {
    return { speech: 'I am here. My cloud brain is not connected, but I can still help with local commands.', actions: [], intent: 'chat' };
  }
  return {
    speech: 'I can hear you, but my cloud brain is not connected yet. I can still control local media, change voice mode, translate mode settings, and store this conversation.',
    actions: [],
    intent: 'chat',
  };
}
