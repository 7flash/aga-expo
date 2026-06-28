import type { SpeakOptions } from './tts';

export type TtsQueueEvent = {
  type: 'queued' | 'start' | 'finish' | 'cancel' | 'error' | 'drain';
  id: string;
  text?: string;
  error?: string;
  at: number;
  queueDepth: number;
};

type Listener = (event: TtsQueueEvent) => void;

type QueueItem = {
  id: string;
  text: string;
  opts: SpeakOptions;
  run: () => Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
  cancelled: boolean;
};

const listeners = new Set<Listener>();
const queue: QueueItem[] = [];
let active: QueueItem | null = null;
let serial = 0;
let generation = 0;
let lastEvent: TtsQueueEvent | null = null;

function now() { return Date.now(); }
function clean(value: unknown) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function nextId() { serial += 1; return `tts-${Date.now().toString(36)}-${serial.toString(36)}`; }

function emit(event: Omit<TtsQueueEvent, 'at' | 'queueDepth'>) {
  lastEvent = { ...event, at: now(), queueDepth: queue.length };
  for (const listener of Array.from(listeners)) {
    try { listener(lastEvent); } catch { /* listener isolation */ }
  }
}

export function subscribeTtsQueue(listener: Listener) {
  listeners.add(listener);
  if (lastEvent) listener(lastEvent);
  return () => listeners.delete(listener);
}

export function getTtsQueueSnapshot() {
  return {
    active: active ? { id: active.id, text: active.text } : null,
    queueDepth: queue.length,
    lastEvent,
    generation,
  };
}

export function cancelQueuedTts(reason = 'cancelled') {
  generation += 1;
  while (queue.length) {
    const item = queue.shift()!;
    item.cancelled = true;
    emit({ type: 'cancel', id: item.id, text: `${reason}: ${item.text}` });
    item.resolve();
  }
}

async function pump(myGeneration: number) {
  if (active) return;
  const item = queue.shift();
  if (!item) {
    emit({ type: 'drain', id: 'none' });
    return;
  }

  if (item.cancelled || myGeneration !== generation) {
    emit({ type: 'cancel', id: item.id, text: item.text });
    item.resolve();
    setTimeout(() => void pump(generation), 0);
    return;
  }

  active = item;
  emit({ type: 'start', id: item.id, text: item.text });
  try {
    await item.run();
    emit({ type: 'finish', id: item.id, text: item.text });
    item.resolve();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? 'TTS failed');
    emit({ type: 'error', id: item.id, text: item.text, error: message });
    item.reject(error);
  } finally {
    if (active?.id === item.id) active = null;
    setTimeout(() => void pump(generation), 0);
  }
}

/**
 * Serializes every voice-output request. This is intentionally below speechOut.ts
 * so even old direct speakText() call-sites cannot overlap audio.
 */
export function enqueueExclusiveTts(text: string, opts: SpeakOptions, run: () => Promise<void>) {
  const spoken = clean(text);
  if (!spoken) return Promise.resolve();

  if (opts.interrupt !== false) {
    // Drop stale queued replies. The active provider should be stopped by stopTts()
    // before this function is called; this layer still prevents queued overlap.
    cancelQueuedTts('interrupt');
  }

  const myGeneration = generation;
  return new Promise<void>((resolve, reject) => {
    const item: QueueItem = { id: nextId(), text: spoken, opts, run, resolve, reject, cancelled: false };
    queue.push(item);
    emit({ type: 'queued', id: item.id, text: spoken });
    void pump(myGeneration);
  });
}
