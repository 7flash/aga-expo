import type { VoicePhase, VoiceTranscriptLine } from './voiceTurnMachine';

export type TurnPhase = VoicePhase;
export type TranscriptLine = VoiceTranscriptLine;

function clean(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function phaseFromLegacySnapshot(snapshot: any): TurnPhase {
  const mode = String(snapshot?.mode || '').toLowerCase();
  const status = clean(snapshot?.speechStatus).toLowerCase();
  const session = clean(snapshot?.sessionLabel).toLowerCase();
  if (snapshot?.error) return 'error';
  if (mode === 'sleeping') return 'sleeping';
  if (mode === 'awake') return 'wake_detected';
  if (mode === 'listening') return /hearing|post-wake|command/.test(status) ? 'capturing_user' : 'wake_listening';
  if (mode === 'thinking') return /tool|checking|routing/.test(status) ? 'tool_call' : 'thinking';
  if (mode === 'speaking') return 'speaking';
  if (mode === 'recovering') return 'recovering';
  if (mode === 'media') return 'media';
  if (session) return 'guided_session';
  return 'wake_listening';
}

export function currentTurnPhase(snapshot: any): TurnPhase {
  return snapshot?.voiceTurn?.phase || snapshot?.turnPhase || phaseFromLegacySnapshot(snapshot);
}

export function isMicOpenForUser(snapshot: any, allowBargeIn = false) {
  const voiceTurn = snapshot?.voiceTurn;
  if (voiceTurn) return !!voiceTurn.canAcceptUserSpeech || (allowBargeIn && voiceTurn.phase === 'speaking');
  const phase = currentTurnPhase(snapshot);
  if (allowBargeIn && phase === 'speaking') return true;
  return ['wake_listening', 'capturing_user', 'guided_session', 'live_session'].includes(phase);
}

export function turnPhaseLabel(phase: TurnPhase) {
  switch (phase) {
    case 'booting': return 'Starting AGA';
    case 'sleeping': return 'Sleeping';
    case 'wake_listening': return 'Your turn';
    case 'wake_detected': return 'Wake detected';
    case 'capturing_user': return 'Listening to you';
    case 'transcribing': return 'Understanding your words';
    case 'thinking': return 'AGA is thinking';
    case 'tool_call': return 'AGA is using a tool';
    case 'speaking': return 'AGA is speaking';
    case 'guided_session': return 'Guided session';
    case 'live_session': return 'Live conversation';
    case 'media': return 'Media playing';
    case 'recovering': return 'Recovering';
    case 'error': return 'Needs attention';
    default: return 'AGA';
  }
}

export function turnPhaseHint(phase: TurnPhase) {
  switch (phase) {
    case 'wake_listening': return 'Mic is open. Speak naturally.';
    case 'wake_detected': return 'AGA heard the wake signal and is opening the command ear.';
    case 'capturing_user': return 'Keep speaking. AGA is capturing this turn.';
    case 'transcribing': return 'Mic is paused while AGA converts speech to text.';
    case 'thinking': return 'Mic is paused while AGA decides what to do.';
    case 'tool_call': return 'Mic is paused while AGA checks a tool or setting.';
    case 'speaking': return 'Mic is paused so AGA does not hear itself.';
    case 'guided_session': return 'Follow the spoken guidance. Say stop, pause, repeat, deeper, or next.';
    case 'live_session': return 'Live conversation is active.';
    case 'media': return 'Say pause, resume, stop, quieter, or louder.';
    case 'recovering': return 'AGA is resetting the voice path.';
    case 'error': return 'Check the error text, then restart the voice path.';
    case 'sleeping': return 'Wake path is inactive.';
    default: return '';
  }
}

export function transcriptFromSnapshot(snapshot: any, max = 80): TranscriptLine[] {
  const canonical = snapshot?.voiceTurn?.transcript;
  if (Array.isArray(canonical) && canonical.length) return canonical.slice(-max);

  const rows: TranscriptLine[] = [];
  const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    const role = ['user', 'assistant', 'tool', 'system'].includes(String(message?.role)) ? message.role : 'system';
    const text = clean(message?.content);
    if (!text) continue;
    rows.push({ id: `message_${i}`, turnId: `legacy_${i}`, role, text, createdAt: message?.createdAt || '', final: true, source: 'messages' });
  }
  const interim = clean(snapshot?.interim);
  if (interim) rows.push({ id: 'interim', turnId: 'legacy_interim', role: 'user', text: interim, createdAt: new Date().toISOString(), final: false, source: 'interim' });
  const heard = clean(snapshot?.heardText);
  if (heard && !rows.some((row) => row.text === heard)) rows.push({ id: 'heard', turnId: 'legacy_heard', role: 'user', text: heard, createdAt: new Date().toISOString(), final: true, source: 'heardText' });
  return rows.slice(-max);
}
