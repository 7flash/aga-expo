import {
  getAssistantPreferences,
  listAgentRuns,
  listCommandEvents,
  listMediaSessions,
  listTranslationSessions,
  saveCommandEvent,
} from './db';
import { measured } from './measure';

function configured(name: string) {
  return Boolean(process.env[name] && String(process.env[name]).trim());
}

export async function getHealthReport() {
  return measured('health.report', async () => {
    const preferences = getAssistantPreferences();
    const report = {
      ok: true,
      app: 'AGA',
      timestamp: new Date().toISOString(),
      env: {
        openai: configured('OPENAI_API_KEY'),
        gemini: configured('GEMINI_API_KEY'),
        youtube: configured('YOUTUBE_API_KEY'),
        databasePath: process.env.DATABASE_PATH ?? './data/assistant.db',
        bgrunMode: process.env.BGRUN_MODE ?? 'local-device',
      },
      preferences,
      recent: {
        commandEvents: listCommandEvents(8),
        mediaSessions: listMediaSessions(5),
        translationSessions: listTranslationSessions(5),
        agentRuns: listAgentRuns(5),
      },
      reliability: {
        voiceOnlyRecoveryCommands: ['stop', 'cancel', 'repeat', 'louder', 'quieter', 'restart listening', 'help'],
        nativeLayerNeededForProduction: [
          'true Android wake word outside WebView',
          'foreground microphone service',
          'echo cancellation for speech while speaking',
          'audio-focus and Bluetooth route control',
        ],
      },
    };

    saveCommandEvent('health.report', {
      openai: report.env.openai,
      gemini: report.env.gemini,
      youtube: report.env.youtube,
    });

    return report;
  });
}
