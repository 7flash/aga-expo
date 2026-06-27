import type { UserPreferences } from '../db/schema';
import type { StorageSummary } from '../db/backup';
import type { VoiceDiagnostics } from '../voice/voiceDiagnostics';

export type SetupSeverity = 'ok' | 'warn' | 'fail';

export type SetupItem = {
  key: string;
  label: string;
  severity: SetupSeverity;
  detail: string;
  fix?: string;
};

export type SetupReport = {
  generatedAt: string;
  readyForVoiceOnly: boolean;
  score: number;
  items: SetupItem[];
  summary: string;
};

export type SetupInput = {
  prefs: UserPreferences | null;
  voiceAvailable: boolean;
  notificationStatus: string;
  storageSummary: StorageSummary | null;
  voiceDiagnostics: VoiceDiagnostics | null;
  lastError?: string | null;
};

function item(key: string, label: string, severity: SetupSeverity, detail: string, fix?: string): SetupItem {
  return { key, label, severity, detail, fix };
}

function hasCloudBrain(prefs: UserPreferences | null) {
  if (!prefs) return false;
  if (prefs.backendMode === 'offline') return true;
  if (prefs.backendMode === 'openai-direct') return !!prefs.openaiApiKey;
  if (prefs.backendMode === 'gemini-direct') return !!prefs.geminiApiKey;
  if (prefs.backendMode === 'tradjs-remote') return !!prefs.remoteBackendUrl;
  return false;
}

export function buildSetupReport(input: SetupInput): SetupReport {
  const { prefs, voiceAvailable, notificationStatus, storageSummary, voiceDiagnostics, lastError } = input;
  const items: SetupItem[] = [];

  items.push(
    voiceAvailable
      ? item('voice-module', 'Native speech module', 'ok', 'Native speech recognition module is installed.')
      : item('voice-module', 'Native speech module', 'fail', '@react-native-voice/voice is not available in this build.', 'Install the dependency and rebuild a dev client/APK.')
  );

  const restarts = voiceDiagnostics?.restarts ?? 0;
  const errors = voiceDiagnostics?.errors ?? 0;
  items.push(
    errors <= 2
      ? item('voice-loop', 'Speech loop stability', restarts > 12 ? 'warn' : 'ok', `${voiceDiagnostics?.starts ?? 0} starts, ${restarts} restarts, ${errors} errors.`)
      : item('voice-loop', 'Speech loop stability', 'warn', `${errors} speech errors observed.`, 'Run “AGA repair yourself”, then test in a quiet room.')
  );

  items.push(
    prefs?.speechWatchdogEnabled
      ? item('watchdog', 'Speech watchdog', 'ok', 'Voice watchdog is enabled.')
      : item('watchdog', 'Speech watchdog', 'warn', 'Voice watchdog is disabled.', 'Say “AGA turn speech watchdog on”.')
  );

  items.push(
    prefs?.wakePhrase && prefs.wakePhrase.trim().split(/\s+/).length >= 2
      ? item('wake-phrase', 'Wake phrase', 'ok', `Wake phrase is “${prefs.wakePhrase}”.`)
      : item('wake-phrase', 'Wake phrase', 'warn', `Wake phrase is “${prefs?.wakePhrase ?? 'unknown'}”.`, 'Use a two-word phrase like “hey aga” or “okay angel”.')
  );

  items.push(
    prefs?.firstRunComplete
      ? item('first-run', 'First-run setup', 'ok', 'Setup is marked complete.')
      : item('first-run', 'First-run setup', 'warn', 'Setup is still open.', 'Say “AGA complete setup” after testing voice, brain, and reminders.')
  );

  items.push(
    hasCloudBrain(prefs)
      ? item('brain', 'Assistant brain', 'ok', prefs?.backendMode === 'offline' ? 'Offline brain mode is active.' : `${prefs?.backendMode} is configured.`)
      : item('brain', 'Assistant brain', 'warn', `${prefs?.backendMode ?? 'unknown'} is selected but not configured.`, 'Add an API key or switch to offline brain mode.')
  );

  items.push(
    notificationStatus === 'granted' || notificationStatus === 'off'
      ? item('notifications', 'Local notifications', notificationStatus === 'off' ? 'warn' : 'ok', notificationStatus === 'off' ? 'Notifications are disabled.' : 'Notification permission is granted.')
      : item('notifications', 'Local notifications', 'warn', `Notification status: ${notificationStatus}.`, 'Say “AGA request notification permission”.')
  );

  items.push(
    storageSummary
      ? item('sqlite', 'Local SQLite memory', 'ok', `${storageSummary.messages} messages, ${storageSummary.memories} memories, ${storageSummary.reminders} reminders.`)
      : item('sqlite', 'Local SQLite memory', 'warn', 'Storage summary has not loaded yet.', 'Say “AGA storage summary”.')
  );

  if (lastError) {
    items.push(item('last-error', 'Last recovery note', 'warn', lastError, 'Say “AGA repair yourself” if this repeats.'));
  }

  const failCount = items.filter((entry) => entry.severity === 'fail').length;
  const warnCount = items.filter((entry) => entry.severity === 'warn').length;
  const score = Math.max(0, Math.round(100 - failCount * 35 - warnCount * 8));
  const readyForVoiceOnly = failCount === 0 && warnCount <= 2;
  const summary = readyForVoiceOnly
    ? `AGA is ready for voice-only testing with score ${score}.`
    : `AGA needs attention: ${failCount} blocker${failCount === 1 ? '' : 's'}, ${warnCount} warning${warnCount === 1 ? '' : 's'}, score ${score}.`;

  return {
    generatedAt: new Date().toISOString(),
    readyForVoiceOnly,
    score,
    items,
    summary,
  };
}

export function setupReportSpeech(report: SetupReport) {
  const blockers = report.items.filter((entry) => entry.severity === 'fail');
  const warnings = report.items.filter((entry) => entry.severity === 'warn');
  if (report.readyForVoiceOnly) return report.summary;
  const top = [...blockers, ...warnings].slice(0, 3).map((entry) => `${entry.label}: ${entry.detail}`);
  return `${report.summary} ${top.join(' ')}`.trim();
}