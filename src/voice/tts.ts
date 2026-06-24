import * as Speech from 'expo-speech';
import type { Persona } from '../aga/personas';

type QueueItem = {
  text: string;
  persona: Persona;
  onDone?: () => void;
};

const queue: QueueItem[] = [];
let active: QueueItem | null = null;
let interrupted = false;

function finishCurrent() {
  const done = active?.onDone;
  active = null;
  done?.();
  if (!interrupted) drainQueue();
}

function drainQueue() {
  if (active || !queue.length) return;
  active = queue.shift() ?? null;
  if (!active) return;
  interrupted = false;
  Speech.speak(active.text.slice(0, Speech.maxSpeechInputLength || 4000), {
    rate: active.persona.speechRate,
    pitch: active.persona.pitch,
    onDone: finishCurrent,
    onStopped: finishCurrent,
    onError: finishCurrent,
  });
}

export async function stopSpeaking() {
  interrupted = true;
  queue.length = 0;
  active = null;
  try {
    Speech.stop();
  } catch {
    // best effort
  }
}

export function speak(text: string, persona: Persona, onDone?: () => void, options: { interrupt?: boolean } = {}) {
  if (!text.trim()) return;
  if (options.interrupt !== false) {
    void stopSpeaking();
  }
  queue.push({ text, persona, onDone });
  drainQueue();
}

export function queueSpeech(text: string, persona: Persona, onDone?: () => void) {
  speak(text, persona, onDone, { interrupt: false });
}

export async function isSpeaking() {
  try {
    return Speech.isSpeakingAsync();
  } catch {
    return false;
  }
}

export function ttsDiagnostics() {
  return {
    active: !!active,
    queueDepth: queue.length,
  };
}
