import type { VoiceTransportSnapshot } from './VoiceTransport';
import { VoiceTurnMachine, type VoicePhase, type VoiceTurnSnapshot } from './voiceTurnMachine';

export const voiceTurnMachine = new VoiceTurnMachine({ maxTranscript: 160 });

function clean(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function phaseFromTransportMode(mode: unknown, snapshot?: Partial<VoiceTransportSnapshot>): VoicePhase {
  const m = String(mode || '').toLowerCase();
  const status = clean((snapshot as any)?.speechStatus).toLowerCase();
  const sessionLabel = clean((snapshot as any)?.sessionLabel).toLowerCase();

  if (m === 'sleeping') return 'sleeping';
  if (m === 'awake') return 'wake_detected';
  if (m === 'listening') {
    if (/hearing|listening to|post-wake|command window/.test(status)) return 'capturing_user';
    return 'wake_listening';
  }
  if (m === 'thinking') {
    if (/tool|checking|routing/.test(status)) return 'tool_call';
    return 'thinking';
  }
  if (m === 'speaking') return 'speaking';
  if (m === 'media') return 'media';
  if (m === 'recovering') return 'recovering';
  if (m === 'translating') return 'capturing_user';
  if (sessionLabel && /guided|breath|hypnosis|conflict|body scan|session/.test(sessionLabel)) return 'guided_session';
  return 'wake_listening';
}

export function observeVoiceTransportPatch(
  patch: Partial<VoiceTransportSnapshot> & Record<string, any>,
  previous: Partial<VoiceTransportSnapshot> = {},
): VoiceTurnSnapshot {
  const next = { ...previous, ...patch } as Partial<VoiceTransportSnapshot> & Record<string, any>;
  const status = clean(next.speechStatus);
  const interim = clean(next.interim);
  const heardText = clean(next.heardText);
  const error = clean(next.error);
  const modeChanged = patch.mode != null;

  if (error) voiceTurnMachine.transition('error', { status: error, source: 'transport.error' });
  else if (modeChanged) voiceTurnMachine.transition(phaseFromTransportMode(patch.mode, next), { status, source: 'transport.mode' });

  if (heardText && !/^keyword detected:/i.test(heardText)) {
    voiceTurnMachine.userText(heardText, { final: true, source: 'heardText' });
  }
  if (interim) {
    voiceTurnMachine.userText(interim, { final: false, source: 'interim' });
  }

  const messages = Array.isArray(next.messages) ? next.messages : [];
  for (const message of messages.slice(-8)) {
    const role = String(message?.role || '').toLowerCase();
    const content = clean(message?.content);
    if (!content) continue;
    if (role === 'user') voiceTurnMachine.userText(content, { final: true, source: 'messages' });
    else if (role === 'assistant') voiceTurnMachine.assistantText(content, { final: true, source: 'messages' });
    else voiceTurnMachine.systemText(content, { source: 'messages' });
  }

  if (status && patch.mode === 'speaking' && !heardText) {
    // A lot of short replies only publish speechStatus. Mirror it into transcript so the recent transcript is not empty.
    voiceTurnMachine.assistantText(status, { final: true, source: 'speechStatus' });
  }

  return voiceTurnMachine.getSnapshot();
}

export function voiceTurnSnapshotPatch(): { voiceTurn: VoiceTurnSnapshot; turnPhase: VoicePhase; canAcceptUserSpeech: boolean } {
  const voiceTurn = voiceTurnMachine.getSnapshot();
  return {
    voiceTurn,
    turnPhase: voiceTurn.phase,
    canAcceptUserSpeech: voiceTurn.canAcceptUserSpeech,
  };
}

export function canAcceptUserSpeech() {
  return voiceTurnMachine.canAcceptUserSpeech();
}

export function markAssistantSpeaking(text: string, source = 'speechOut') {
  return voiceTurnMachine.assistantText(text, { final: true, source });
}

export function markAssistantSpeechDone(source = 'speechOut') {
  const current = voiceTurnMachine.getSnapshot();
  if (current.phase === 'speaking') return voiceTurnMachine.transition('wake_listening', { status: 'your turn', source });
  return current;
}

export function blockUserCapture(reason: string) {
  return voiceTurnMachine.block(reason);
}
