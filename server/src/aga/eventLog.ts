import { saveCommandEvent } from '../db';

export function logAgaEvent(kind: string, payload: Record<string, unknown> = {}) {
  try {
    saveCommandEvent(`aga.${kind}`, {
      ...payload,
      at: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('[aga:event-log:error]', kind, error instanceof Error ? error.message : String(error));
  }
}

export function logAgaError(kind: string, error: unknown, payload: Record<string, unknown> = {}) {
  logAgaEvent(`${kind}.error`, {
    ...payload,
    error: error instanceof Error ? error.message : String(error),
  });
}
