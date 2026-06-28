import type { VoiceTranscriptLine } from './voiceTurnMachine';

type Listener = (lines: VoiceTranscriptLine[]) => void;

const STORAGE_KEY = 'aga.recentTranscript.v1';
const listeners = new Set<Listener>();
let lines: VoiceTranscriptLine[] = [];
let loaded = false;

function nowIso() { return new Date().toISOString(); }
function clean(value: unknown) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function storage(): Storage | null {
  try {
    const root: any = globalThis as any;
    return root?.localStorage || null;
  } catch { return null; }
}

function loadOnce() {
  if (loaded) return;
  loaded = true;
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) lines = parsed.filter((x) => x && typeof x.text === 'string').slice(-240);
  } catch { lines = []; }
}

function persist() {
  try { storage()?.setItem(STORAGE_KEY, JSON.stringify(lines.slice(-240))); } catch { /* ignore */ }
}

function emit() {
  const snapshot = getRecentTranscript();
  for (const listener of Array.from(listeners)) {
    try { listener(snapshot); } catch { /* isolate */ }
  }
}

function keyFor(line: VoiceTranscriptLine) {
  return `${line.turnId}:${line.role}:${clean(line.text).toLowerCase()}`;
}

export function getRecentTranscript(max = 160) {
  loadOnce();
  return lines.slice(-max);
}

export function subscribeRecentTranscript(listener: Listener) {
  loadOnce();
  listeners.add(listener);
  listener(getRecentTranscript());
  return () => listeners.delete(listener);
}

export function appendRecentTranscript(input: Partial<VoiceTranscriptLine> & { role: VoiceTranscriptLine['role']; text: string }) {
  loadOnce();
  const text = clean(input.text);
  if (!text) return getRecentTranscript();
  const line: VoiceTranscriptLine = {
    id: input.id || `line-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    turnId: input.turnId || 'unknown-turn',
    role: input.role,
    text,
    createdAt: input.createdAt || nowIso(),
    final: input.final !== false,
    source: input.source || 'recentTranscriptStore',
  };

  const existingIndex = lines.findIndex((candidate) => keyFor(candidate) === keyFor(line));
  if (existingIndex >= 0) {
    lines[existingIndex] = { ...lines[existingIndex], ...line, id: lines[existingIndex].id, createdAt: lines[existingIndex].createdAt };
  } else {
    lines.push(line);
  }
  lines = lines.slice(-240);
  persist();
  emit();
  return getRecentTranscript();
}

export function mergeRecentTranscript(nextLines: VoiceTranscriptLine[]) {
  loadOnce();
  for (const line of nextLines || []) appendRecentTranscript(line);
  return getRecentTranscript();
}

export function clearRecentTranscript() {
  lines = [];
  persist();
  emit();
}
