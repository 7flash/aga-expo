export type PlayerMessage =
  | { type: 'ready'; player: 'youtube' | 'music' }
  | { type: 'state'; player: 'youtube' | 'music'; state: 'idle' | 'playing' | 'paused' | 'ended' | 'error' }
  | { type: 'ended'; player: 'youtube' | 'music' }
  | { type: 'error'; player: 'youtube' | 'music'; message?: string }
  | { type: 'progress'; player: 'youtube' | 'music'; positionMs?: number; durationMs?: number };

const VALID_TYPES = new Set(['ready', 'state', 'ended', 'error', 'progress']);
const VALID_PLAYERS = new Set(['youtube', 'music']);
const VALID_STATES = new Set(['idle', 'playing', 'paused', 'ended', 'error']);

export function parsePlayerMessage(raw: string): { ok: true; value: PlayerMessage } | { ok: false; error: string } {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }

  if (!data || typeof data !== 'object') return { ok: false, error: 'payload_not_object' };
  if (!VALID_TYPES.has(data.type)) return { ok: false, error: 'invalid_type' };
  if (!VALID_PLAYERS.has(data.player)) return { ok: false, error: 'invalid_player' };

  if (data.type === 'state') {
    if (!VALID_STATES.has(data.state)) return { ok: false, error: 'invalid_state' };
    return { ok: true, value: { type: 'state', player: data.player, state: data.state } };
  }

  if (data.type === 'error') {
    return { ok: true, value: { type: 'error', player: data.player, message: typeof data.message === 'string' ? data.message.slice(0, 240) : undefined } };
  }

  if (data.type === 'progress') {
    const positionMs = typeof data.positionMs === 'number' && Number.isFinite(data.positionMs) ? Math.max(0, data.positionMs) : undefined;
    const durationMs = typeof data.durationMs === 'number' && Number.isFinite(data.durationMs) ? Math.max(0, data.durationMs) : undefined;
    return { ok: true, value: { type: 'progress', player: data.player, positionMs, durationMs } };
  }

  if (data.type === 'ended') return { ok: true, value: { type: 'ended', player: data.player } };
  return { ok: true, value: { type: 'ready', player: data.player } };
}
