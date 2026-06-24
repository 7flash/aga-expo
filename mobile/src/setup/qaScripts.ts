export type QaStep = {
  id: string;
  command: string;
  expected: string;
  phase: 'voice' | 'memory' | 'media' | 'translation' | 'routines' | 'recovery' | 'production';
};

export const VOICE_ONLY_QA_STEPS: QaStep[] = [
  { id: 'wake-help', phase: 'voice', command: 'Hey AGA, help', expected: 'AGA speaks available command categories.' },
  { id: 'diagnostics', phase: 'voice', command: 'Hey AGA, show diagnostics', expected: 'Diagnostics panel appears and AGA stays responsive.' },
  { id: 'memory-save', phase: 'memory', command: 'Hey AGA, remember that my test project is AGA', expected: 'Memory note is saved locally.' },
  { id: 'memory-recall', phase: 'memory', command: 'Hey AGA, what do you remember?', expected: 'AGA recalls the saved memory.' },
  { id: 'reminder', phase: 'routines', command: 'Hey AGA, remind me to stretch in one minute', expected: 'Reminder appears, fires in foreground, and notification is scheduled if permission exists.' },
  { id: 'tts-rate', phase: 'voice', command: 'Hey AGA, speak slower', expected: 'Speech rate changes and persists.' },
  { id: 'youtube', phase: 'media', command: 'Hey AGA, play lo-fi on YouTube', expected: 'YouTube player loads and now-playing updates.' },
  { id: 'pause', phase: 'media', command: 'Hey AGA, pause', expected: 'Media pauses and state changes.' },
  { id: 'resume', phase: 'media', command: 'Hey AGA, resume', expected: 'Media resumes and state changes.' },
  { id: 'favorite', phase: 'media', command: 'Hey AGA, save this to favorites', expected: 'Current media is saved as a local favorite.' },
  { id: 'translate', phase: 'translation', command: 'Hey AGA, translate to Indonesian', expected: 'Translation mode activates.' },
  { id: 'translate-stop', phase: 'translation', command: 'Hey AGA, stop translating', expected: 'Translation mode deactivates.' },
  { id: 'repair', phase: 'recovery', command: 'Hey AGA, repair yourself', expected: 'Migrations rerun, logs trim, speech loop restarts.' },
  { id: 'backup', phase: 'production', command: 'Hey AGA, export local backup', expected: 'Backup JSON is created and shared/copied when optional modules exist.' },
];

export function qaScriptSpeech() {
  return `Voice-only QA has ${VOICE_ONLY_QA_STEPS.length} steps. Start with: ${VOICE_ONLY_QA_STEPS[0].command}. Then test memory, reminders, media, translation, repair, and backup.`;
}

export function phaseSummary() {
  const counts = VOICE_ONLY_QA_STEPS.reduce<Record<string, number>>((acc, step) => {
    acc[step.phase] = (acc[step.phase] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).map(([phase, count]) => `${phase}: ${count}`).join(' · ');
}
