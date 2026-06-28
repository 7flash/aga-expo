export type VoicePhase =
  | 'booting'
  | 'sleeping'
  | 'wake_listening'
  | 'wake_detected'
  | 'capturing_user'
  | 'transcribing'
  | 'thinking'
  | 'tool_call'
  | 'speaking'
  | 'guided_session'
  | 'live_session'
  | 'media'
  | 'recovering'
  | 'error';

export type TranscriptRole = 'user' | 'assistant' | 'tool' | 'system';

export type VoiceTranscriptLine = {
  id: string;
  turnId: string;
  role: TranscriptRole;
  text: string;
  createdAt: string;
  final?: boolean;
  source?: string;
};

export type VoiceTurn = {
  id: string;
  phase: VoicePhase;
  owner: 'user' | 'aga' | 'system';
  mic: 'open' | 'closed' | 'blocked';
  turnIndex: number;
  startedAt: string;
  updatedAt: string;
  inputText?: string;
  outputText?: string;
  status?: string;
  source?: string;
};

export type VoiceTurnSnapshot = {
  phase: VoicePhase;
  owner: VoiceTurn['owner'];
  mic: VoiceTurn['mic'];
  canAcceptUserSpeech: boolean;
  activeTurn: VoiceTurn;
  transcript: VoiceTranscriptLine[];
  lastUserText?: string;
  lastAssistantText?: string;
  blockedReason?: string;
};

type Listener = (snapshot: VoiceTurnSnapshot) => void;

type TransitionOptions = {
  status?: string;
  source?: string;
  inputText?: string;
  outputText?: string;
  forceNewTurn?: boolean;
};

function nowIso() {
  return new Date().toISOString();
}

function clean(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function safePrefix(value: string, max = 220) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function ownerForPhase(phase: VoicePhase): VoiceTurn['owner'] {
  if (phase === 'capturing_user' || phase === 'transcribing' || phase === 'wake_detected') return 'user';
  if (phase === 'thinking' || phase === 'tool_call' || phase === 'speaking' || phase === 'guided_session' || phase === 'live_session') return 'aga';
  return 'system';
}

function micForPhase(phase: VoicePhase): VoiceTurn['mic'] {
  if (phase === 'wake_listening' || phase === 'capturing_user' || phase === 'live_session' || phase === 'guided_session') return 'open';
  if (phase === 'speaking' || phase === 'thinking' || phase === 'tool_call' || phase === 'transcribing') return 'closed';
  if (phase === 'error' || phase === 'recovering') return 'blocked';
  return 'closed';
}

function acceptsSpeech(phase: VoicePhase, mic: VoiceTurn['mic']) {
  return mic === 'open' && !['speaking', 'thinking', 'tool_call', 'transcribing', 'recovering', 'error'].includes(phase);
}

export class VoiceTurnMachine {
  private listeners = new Set<Listener>();
  private turnIndex = 0;
  private activeTurn: VoiceTurn;
  private transcript: VoiceTranscriptLine[] = [];
  private lastUserText = '';
  private lastAssistantText = '';
  private blockedReason = '';
  private maxTranscript: number;

  constructor(options: { maxTranscript?: number } = {}) {
    this.maxTranscript = options.maxTranscript ?? 120;
    this.activeTurn = this.newTurn('booting', { status: 'starting' });
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): VoiceTurnSnapshot {
    return {
      phase: this.activeTurn.phase,
      owner: this.activeTurn.owner,
      mic: this.activeTurn.mic,
      canAcceptUserSpeech: acceptsSpeech(this.activeTurn.phase, this.activeTurn.mic),
      activeTurn: this.activeTurn,
      transcript: [...this.transcript],
      lastUserText: this.lastUserText || undefined,
      lastAssistantText: this.lastAssistantText || undefined,
      blockedReason: this.blockedReason || undefined,
    };
  }

  transition(phase: VoicePhase, options: TransitionOptions = {}) {
    const sameTurnPhases: VoicePhase[] = ['wake_detected', 'capturing_user', 'transcribing', 'thinking', 'tool_call', 'speaking'];
    const shouldNewTurn = options.forceNewTurn || (
      phase === 'wake_detected' ||
      (phase === 'capturing_user' && !sameTurnPhases.includes(this.activeTurn.phase))
    );

    if (shouldNewTurn) this.activeTurn = this.newTurn(phase, options);
    else this.activeTurn = this.patchTurn(phase, options);

    if (phase !== 'recovering' && phase !== 'error') this.blockedReason = '';
    this.emit();
    return this.getSnapshot();
  }

  wakeDetected(source = 'wake') {
    return this.transition('wake_detected', { source, status: 'wake detected', forceNewTurn: true });
  }

  captureStarted(source = 'capture') {
    return this.transition('capturing_user', { source, status: 'listening to user' });
  }

  userText(text: string, options: { final?: boolean; source?: string } = {}) {
    const cleanText = clean(text);
    if (!cleanText) return this.getSnapshot();
    this.lastUserText = cleanText;
    this.activeTurn = this.patchTurn(options.final === false ? 'capturing_user' : 'thinking', {
      inputText: cleanText,
      source: options.source || 'user',
      status: options.final === false ? `hearing: ${safePrefix(cleanText, 80)}` : `heard: ${safePrefix(cleanText, 80)}`,
    });
    this.upsertTranscript('user', cleanText, { final: options.final !== false, source: options.source || 'user' });
    this.emit();
    return this.getSnapshot();
  }

  assistantText(text: string, options: { final?: boolean; source?: string } = {}) {
    const cleanText = clean(text);
    if (!cleanText) return this.getSnapshot();
    this.lastAssistantText = cleanText;
    this.activeTurn = this.patchTurn('speaking', {
      outputText: cleanText,
      source: options.source || 'assistant',
      status: safePrefix(cleanText, 96),
    });
    this.upsertTranscript('assistant', cleanText, { final: options.final !== false, source: options.source || 'assistant' });
    this.emit();
    return this.getSnapshot();
  }

  toolText(text: string, options: { source?: string } = {}) {
    const cleanText = clean(text);
    if (!cleanText) return this.getSnapshot();
    this.activeTurn = this.patchTurn('tool_call', {
      status: safePrefix(cleanText, 96),
      source: options.source || 'tool',
    });
    this.upsertTranscript('tool', cleanText, { final: true, source: options.source || 'tool' });
    this.emit();
    return this.getSnapshot();
  }

  systemText(text: string, options: { source?: string; phase?: VoicePhase } = {}) {
    const cleanText = clean(text);
    if (!cleanText) return this.getSnapshot();
    this.activeTurn = this.patchTurn(options.phase || this.activeTurn.phase, {
      status: safePrefix(cleanText, 96),
      source: options.source || 'system',
    });
    this.upsertTranscript('system', cleanText, { final: true, source: options.source || 'system' });
    this.emit();
    return this.getSnapshot();
  }

  block(reason: string) {
    this.blockedReason = clean(reason) || 'blocked';
    this.activeTurn = this.patchTurn(this.activeTurn.phase, { status: this.blockedReason });
    this.emit();
    return this.getSnapshot();
  }

  canAcceptUserSpeech() {
    return this.getSnapshot().canAcceptUserSpeech;
  }

  resetTranscript() {
    this.transcript = [];
    this.lastUserText = '';
    this.lastAssistantText = '';
    this.emit();
  }

  private newTurn(phase: VoicePhase, options: TransitionOptions = {}): VoiceTurn {
    this.turnIndex += 1;
    const startedAt = nowIso();
    return {
      id: `turn_${this.turnIndex}_${Date.now().toString(36)}`,
      phase,
      owner: ownerForPhase(phase),
      mic: micForPhase(phase),
      turnIndex: this.turnIndex,
      startedAt,
      updatedAt: startedAt,
      inputText: clean(options.inputText) || undefined,
      outputText: clean(options.outputText) || undefined,
      status: clean(options.status) || undefined,
      source: options.source,
    };
  }

  private patchTurn(phase: VoicePhase, options: TransitionOptions = {}): VoiceTurn {
    return {
      ...this.activeTurn,
      phase,
      owner: ownerForPhase(phase),
      mic: micForPhase(phase),
      updatedAt: nowIso(),
      inputText: clean(options.inputText) || this.activeTurn.inputText,
      outputText: clean(options.outputText) || this.activeTurn.outputText,
      status: clean(options.status) || this.activeTurn.status,
      source: options.source || this.activeTurn.source,
    };
  }

  private upsertTranscript(role: TranscriptRole, text: string, options: { final?: boolean; source?: string }) {
    const cleanText = clean(text);
    if (!cleanText) return;
    const last = this.transcript[this.transcript.length - 1];
    const id = `${this.activeTurn.id}_${role}_${this.transcript.length}_${Date.now().toString(36)}`;

    // Replace live partial text for the same role/turn instead of creating a broken pile of fragments.
    if (last && last.turnId === this.activeTurn.id && last.role === role && last.final === false) {
      last.text = cleanText;
      last.final = options.final !== false;
      last.createdAt = nowIso();
      last.source = options.source;
    } else if (!(last && last.turnId === this.activeTurn.id && last.role === role && last.text === cleanText)) {
      this.transcript.push({
        id,
        turnId: this.activeTurn.id,
        role,
        text: cleanText,
        createdAt: nowIso(),
        final: options.final !== false,
        source: options.source,
      });
    }

    if (this.transcript.length > this.maxTranscript) this.transcript = this.transcript.slice(-this.maxTranscript);
  }

  private emit() {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
