export type VoiceDiagnostics = {
  starts: number;
  restarts: number;
  errors: number;
  partials: number;
  finals: number;
  lastStartAt: string | null;
  lastFinalAt: string | null;
  lastError: string | null;
  lastRestartReason: string | null;
  running: boolean;
};

export function emptyVoiceDiagnostics(): VoiceDiagnostics {
  return {
    starts: 0,
    restarts: 0,
    errors: 0,
    partials: 0,
    finals: 0,
    lastStartAt: null,
    lastFinalAt: null,
    lastError: null,
    lastRestartReason: null,
    running: false,
  };
}
