export type LiveAgentState = {
  active: boolean;
  starting: boolean;
  turnId?: string;
  reason?: string;
  startedAt?: number;
};

type Listener = (state: LiveAgentState) => void;

const state: LiveAgentState = { active: false, starting: false };
const listeners = new Set<Listener>();

function publish() {
  const snapshot = { ...state };
  for (const listener of listeners) {
    try { listener(snapshot); } catch (_) {}
  }
}

export function getLiveAgentState() {
  return { ...state };
}

export function subscribeLiveAgentState(listener: Listener) {
  listeners.add(listener);
  listener({ ...state });
  return () => listeners.delete(listener);
}

export function canStartLiveAgent(turnId: string) {
  if (state.active || state.starting) {
    return {
      ok: false,
      reason: `Live agent already ${state.active ? 'active' : 'starting'} for ${state.turnId || 'unknown turn'}.`,
    };
  }
  return { ok: true, reason: 'ok' };
}

export async function startLiveAgentExclusively<T>(
  turnId: string,
  reason: string,
  start: () => Promise<T>,
): Promise<T> {
  const gate = canStartLiveAgent(turnId);
  if (!gate.ok) throw new Error(gate.reason);

  state.starting = true;
  state.active = false;
  state.turnId = turnId;
  state.reason = reason;
  state.startedAt = Date.now();
  publish();

  try {
    const result = await start();
    state.starting = false;
    state.active = true;
    publish();
    return result;
  } catch (error) {
    state.starting = false;
    state.active = false;
    state.turnId = undefined;
    state.reason = undefined;
    state.startedAt = undefined;
    publish();
    throw error;
  }
}

export function endLiveAgent(reason = 'ended') {
  if (!state.active && !state.starting) return;
  state.active = false;
  state.starting = false;
  state.reason = reason;
  publish();
  state.turnId = undefined;
  state.reason = undefined;
  state.startedAt = undefined;
  publish();
}
