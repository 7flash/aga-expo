export type VoiceTurnPhase =
  | 'idle'
  | 'wake_listening'
  | 'awake'
  | 'capturing_user'
  | 'transcribing'
  | 'routing'
  | 'tool_running'
  | 'thinking'
  | 'speaking'
  | 'live_session'
  | 'guided_session'
  | 'media'
  | 'recovering'
  | 'error';

export type TranscriptLine = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
  createdAt?: string;
  source?: string;
};

function clean(text: unknown) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function textOf(message: any) {
  return clean(message?.content ?? message?.text ?? message?.message ?? message?.transcript ?? '');
}

export function normalizeVoiceTurnPhase(snapshot: any): VoiceTurnPhase {
  const mode = clean(snapshot?.mode).toLowerCase().replace(/_/g, '-');
  const speech = clean(snapshot?.speechStatus).toLowerCase();
  const tts = clean(snapshot?.ttsStatus).toLowerCase();

  if (snapshot?.error || /error|failed|unavailable/.test(speech)) return 'error';
  if (/recover/.test(mode) || /recover/.test(speech)) return 'recovering';
  if (/speak|talking|playing tts/.test(mode) || /speaking|tts/.test(speech) || /speaking/.test(tts)) return 'speaking';
  if (/transcrib/.test(mode) || /transcrib/.test(speech)) return 'transcribing';
  if (/captur|record/.test(mode) || /captur|record/.test(speech)) return 'capturing_user';
  if (/awake|wake detected/.test(mode) || /wake detected/.test(speech)) return 'awake';
  if (/live|duplex|agent/.test(mode) || /live session|agent connected/.test(speech)) return 'live_session';
  if (snapshot?.sessionLabel && /guided|breath|hypnosis|meditation|conflict|body scan/i.test(String(snapshot.sessionLabel))) return 'guided_session';
  if (/tool/.test(mode) || /tool/.test(speech)) return 'tool_running';
  if (/think|reason|route|routing|connect/.test(mode) || /thinking|routing|connecting|sent to/.test(speech)) return 'thinking';
  if (snapshot?.activeMedia) return 'media';
  if (/listen|wake-listening|sleep/.test(mode) || /listening/.test(speech)) return 'wake_listening';
  return 'idle';
}

export function turnPhaseLabel(phase: VoiceTurnPhase) {
  switch (phase) {
    case 'wake_listening': return 'Your turn: say AGA or speak';
    case 'awake': return 'AGA heard you';
    case 'capturing_user': return 'Listening to you';
    case 'transcribing': return 'Understanding your words';
    case 'routing': return 'Choosing what to do';
    case 'tool_running': return 'Running a tool';
    case 'thinking': return 'Thinking';
    case 'speaking': return 'AGA is speaking — mic paused';
    case 'live_session': return 'Live conversation';
    case 'guided_session': return 'Guided session';
    case 'media': return 'Media mode';
    case 'recovering': return 'Recovering';
    case 'error': return 'Needs attention';
    default: return 'Idle';
  }
}

export function turnPhaseHint(phase: VoiceTurnPhase) {
  switch (phase) {
    case 'wake_listening': return 'Microphone is open for wake / next user turn.';
    case 'capturing_user': return 'Speak now. AGA will stop listening when you pause.';
    case 'transcribing': return 'Audio capture is closed while speech is converted to text.';
    case 'thinking': return 'Do not listen yet. Wait until response is ready.';
    case 'tool_running': return 'Tool is running. Mic stays closed unless stop/pause is detected locally.';
    case 'speaking': return 'Normal wake/capture is blocked so AGA does not answer itself.';
    case 'live_session': return 'Continuous mode is active; interruption policy depends on live engine settings.';
    case 'guided_session': return 'Session controls: pause, resume, repeat, skip, deeper, end.';
    case 'error': return 'Show this error in one place; do not duplicate debug panels.';
    default: return 'Waiting.';
  }
}

export function shouldShowMicOpen(phase: VoiceTurnPhase, allowBargeIn = false) {
  if (phase === 'speaking') return !!allowBargeIn;
  return phase === 'wake_listening' || phase === 'capturing_user' || phase === 'live_session';
}

export function transcriptFromSnapshot(snapshot: any, max = 40): TranscriptLine[] {
  const rows: TranscriptLine[] = [];
  const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    const text = textOf(m);
    if (!text) continue;
    const roleRaw = clean(m?.role).toLowerCase();
    const role = roleRaw === 'user' || roleRaw === 'assistant' || roleRaw === 'tool' ? roleRaw : 'system';
    rows.push({
      id: clean(m?.id || m?.createdAt || `${role}-${i}-${text.slice(0, 24)}`),
      role: role as TranscriptLine['role'],
      text,
      createdAt: clean(m?.createdAt || m?.at || ''),
      source: clean(m?.source || ''),
    });
  }

  const interim = clean(snapshot?.interim || snapshot?.heardText || snapshot?.partialTranscript || '');
  if (interim) rows.push({ id: `interim-${Date.now()}`, role: 'user', text: interim, source: 'interim' });

  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.role}:${row.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(-max);
}
