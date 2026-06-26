export type GuidedCompletionSignal = {
  sessionId: string;
  kind: string;
  completed: boolean;
  userStoppedEarly?: boolean;
  moodBefore?: string;
  moodAfter?: string;
  technique?: string;
  durationMs?: number;
};

export type GuidedReflectionDraft = {
  summary: string;
  technique?: string;
  emotionalPattern?: string;
  nextRitual?: string;
};

export function buildGuidedReflectionDraft(signal: GuidedCompletionSignal): GuidedReflectionDraft {
  const kind = signal.kind || 'guided session';
  const technique = signal.technique || kind;
  const completed = signal.completed && !signal.userStoppedEarly;
  const summary = completed
    ? `Completed ${kind}. Technique used: ${technique}. Mood before: ${signal.moodBefore || 'unknown'}. Mood after: ${signal.moodAfter || 'unknown'}.`
    : `Started ${kind} but did not complete it. Technique attempted: ${technique}. Mood before: ${signal.moodBefore || 'unknown'}.`;
  return {
    summary,
    technique,
    emotionalPattern: signal.moodBefore && signal.moodAfter ? `${signal.moodBefore} → ${signal.moodAfter}` : undefined,
    nextRitual: completed ? `Offer ${technique} again when the user asks for similar support.` : `Use a shorter ${technique} variant next time.`,
  };
}

export function shouldSaveGuidedReflection(signal: GuidedCompletionSignal) {
  if (!signal.sessionId || !signal.kind) return false;
  if (signal.completed) return true;
  return !!signal.durationMs && signal.durationMs > 90_000;
}
