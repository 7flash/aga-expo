import { buildWakeRagContext } from '../memory/subconsciousRag';

/**
 * Lightweight hook for WakeRealtimeController/transport layer.
 * Call after wake text is known and append the result to realtime instructions.
 */
export async function buildRelevantTurnContext(initialUserText: string) {
  const rag = await buildWakeRagContext(initialUserText).catch(() => '');
  if (!rag) return '';
  return [
    'Personal relevance context:',
    rag,
    'Safety: this context is suggestive, not authoritative. Ask before making proactive emotional interpretations.',
  ].join('\n');
}
