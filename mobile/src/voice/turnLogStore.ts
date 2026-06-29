export type TurnLogStage =
  | 'received'
  | 'deduped'
  | 'ignored'
  | 'route_decided'
  | 'tool_selected'
  | 'tool_executed'
  | 'short_gpt_started'
  | 'short_gpt_done'
  | 'live_started'
  | 'live_ended'
  | 'tts_started'
  | 'tts_done'
  | 'error';

export type TurnLogEntry = {
  id: string;
  at: number;
  turnId: string;
  stage: TurnLogStage;
  route?: string;
  toolName?: string;
  speaker?: 'user' | 'assistant' | 'system' | 'tool';
  text?: string;
  raw?: unknown;
};

type Listener = (entries: TurnLogEntry[]) => void;

const entries: TurnLogEntry[] = [];
const listeners = new Set<Listener>();
let seq = 0;

function notify() {
  const copy = entries.slice();
  for (const listener of Array.from(listeners)) {
    try { listener(copy); } catch {}
  }
}

export function addTurnLog(entry: Omit<TurnLogEntry, 'id' | 'at'> & { id?: string; at?: number }) {
  const next: TurnLogEntry = {
    id: entry.id ?? `log_${Date.now()}_${++seq}`,
    at: entry.at ?? Date.now(),
    turnId: entry.turnId,
    stage: entry.stage,
    route: entry.route,
    toolName: entry.toolName,
    speaker: entry.speaker,
    text: entry.text,
    raw: entry.raw,
  };
  entries.unshift(next);
  while (entries.length > 200) entries.pop();
  notify();
  return next;
}

export function getTurnLogs() {
  return entries.slice();
}

export function subscribeTurnLogs(listener: Listener) {
  listeners.add(listener);
  listener(entries.slice());
  return () => listeners.delete(listener);
}

export function clearTurnLogs() {
  entries.length = 0;
  notify();
}
