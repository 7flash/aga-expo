import { addMemory, listMessages, logEvent } from '../db/localStore';

function env(name: string) {
  return process.env?.[name] ?? '';
}

function enabled() {
  return String(env('EXPO_PUBLIC_AGA_DREAM_SYNTHESIS') || '1') !== '0';
}

function isNightHour() {
  const hour = new Date().getHours();
  const start = Number(env('EXPO_PUBLIC_AGA_DREAM_START_HOUR') || 2);
  const end = Number(env('EXPO_PUBLIC_AGA_DREAM_END_HOUR') || 5);
  if (start <= end) return hour >= start && hour <= end;
  return hour >= start || hour <= end;
}

export async function runDreamSynthesisOnce(reason = 'idle') {
  if (!enabled()) return { ok: false, reason: 'disabled' };
  if (!isNightHour() && reason !== 'manual') return { ok: false, reason: 'outside_window' };
  const messages = await listMessages(40).catch(() => []);
  const text = messages.map((m: any) => `${m.role || 'unknown'}: ${m.text || m.content || ''}`).join('\n').slice(-6000);
  if (!text.trim()) return { ok: false, reason: 'no_messages' };

  // Local heuristic pass. A server/LLM synthesis can later replace this function,
  // but the write loop is here now: dream can mutate memory and habits.
  const lower = text.toLowerCase();
  const notes: string[] = [];
  if (/box breathing|breathe|breathing/.test(lower)) notes.push('User often engages with breathing support; prefer short breathing first.');
  if (/hypnosis|subconscious|trance/.test(lower)) notes.push('User is interested in subconscious/hypnosis work; keep safety and grounding explicit.');
  if (/conflict|argument|fight|relationship/.test(lower)) notes.push('Conflict support may be recurring; stabilize emotion before problem solving.');
  if (/rain|soundscape|sleep|wind down/.test(lower)) notes.push('Evening soundscape may help wind-down routines.');

  for (const note of notes) await addMemory(`Dream synthesis: ${note}`).catch(() => undefined);
  await logEvent('dream.synthesis', notes.length ? notes.join(' | ') : 'no pattern promoted').catch(() => undefined);
  return { ok: true, promoted: notes.length, notes };
}
