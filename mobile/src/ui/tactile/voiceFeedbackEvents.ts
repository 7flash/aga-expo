export type TactileVoiceFeedbackKind =
  | 'keyword_wake'
  | 'keyword_stop'
  | 'keyword_pause'
  | 'command_understood'
  | 'tool_started'
  | 'tool_completed'
  | 'live_session_opened'
  | 'guided_phase_advanced'
  | 'error';

export type TactileVoiceFeedbackEvent = {
  kind: TactileVoiceFeedbackKind;
  label?: string;
  intensity?: number;
  createdAt: string;
};

export function buildTactileVoiceFeedback(kind: TactileVoiceFeedbackKind, label?: string, intensity = 1): TactileVoiceFeedbackEvent {
  return {
    kind,
    label,
    intensity: Math.max(0, Math.min(1, intensity)),
    createdAt: new Date().toISOString(),
  };
}

export function feedbackToRelicMotion(event: TactileVoiceFeedbackEvent) {
  const intensity = event.intensity ?? 1;
  if (event.kind === 'keyword_wake') return { trace: 'core', pressDepth: 0.2, gaugeKick: 0.45 * intensity };
  if (event.kind === 'keyword_stop') return { trace: 'red_cutoff', pressDepth: 0.9, gaugeKick: 0.8 * intensity };
  if (event.kind === 'keyword_pause') return { trace: 'amber_hold', pressDepth: 0.65, gaugeKick: 0.5 * intensity };
  if (event.kind === 'live_session_opened') return { trace: 'wide_neural', pressDepth: 0.35, gaugeKick: 0.75 * intensity };
  if (event.kind === 'guided_phase_advanced') return { trace: 'slow_breathing', pressDepth: 0.25, gaugeKick: 0.25 * intensity };
  if (event.kind === 'error') return { trace: 'crimson_fault', pressDepth: 0.1, gaugeKick: 1 };
  return { trace: 'cyan_fire', pressDepth: 0.45, gaugeKick: 0.4 * intensity };
}
