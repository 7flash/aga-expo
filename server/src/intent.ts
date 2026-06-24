import { z } from 'sqlite-zod-orm';

export const intentNameSchema = z.enum([
  'chat',
  'help',
  'start_translation',
  'stop_translation',
  'play_music',
  'youtube_search',
  'media_control',
  'configure_voice',
  'configure_name',
  'configure_wake_word',
  'reset_conversation',
  'start_listening',
  'stop_listening',
  'health_check',
  'agent_task',
  'unknown',
]);

export type IntentName = z.infer<typeof intentNameSchema>;

export type AssistantIntent = {
  name: IntentName;
  confidence: number;
  command: string;
  normalized: string;
  args: Record<string, unknown>;
  needsConfirmation: boolean;
  spokenSummary: string;
};

const mediaControlWords = ['pause', 'resume', 'continue', 'stop', 'next', 'previous', 'back', 'volume', 'mute', 'unmute'];

export function normalizeCommand(text: string) {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanCommand(text: string) {
  return text.replace(/^[,\s:;.!-]+/, '').replace(/\s+/g, ' ').trim();
}

function extractAfter(command: string, markers: string[]) {
  const normalized = normalizeCommand(command);
  for (const marker of markers) {
    const markerIndex = normalized.indexOf(marker);
    if (markerIndex >= 0) return cleanCommand(command.slice(markerIndex + marker.length));
  }
  return cleanCommand(command);
}

function parseLanguage(command: string) {
  const normalized = normalizeCommand(command);
  const match = normalized.match(/(?:translate|translation|interpreter|interpret)(?:\s+everything)?\s+(?:to|into|in)\s+([a-z\s]{2,40})/);
  return match?.[1]?.replace(/\bmode\b/g, '').trim();
}

function parseVolume(command: string) {
  const normalized = normalizeCommand(command);
  const pct = normalized.match(/(?:volume|sound)\s+(?:to\s+)?(\d{1,3})\s*(?:percent)?/);
  if (!pct) return null;
  const value = Number(pct[1]);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function result(input: Omit<AssistantIntent, 'needsConfirmation'> & { needsConfirmation?: boolean }): AssistantIntent {
  return {
    needsConfirmation: false,
    ...input,
  };
}

export function classifyIntent(command: string): AssistantIntent {
  const clean = cleanCommand(command);
  const normalized = normalizeCommand(clean);

  if (!normalized) {
    return result({
      name: 'unknown',
      confidence: 0,
      command: clean,
      normalized,
      args: {},
      spokenSummary: 'I did not hear a complete command.',
    });
  }

  if (/\b(help|what can you do|commands|what can i say)\b/.test(normalized)) {
    return result({ name: 'help', confidence: 0.96, command: clean, normalized, args: {}, spokenSummary: 'Show voice commands.' });
  }

  if (/\b(system check|health check|diagnostics|are you ok|status report)\b/.test(normalized)) {
    return result({ name: 'health_check', confidence: 0.94, command: clean, normalized, args: {}, spokenSummary: 'Run diagnostics.' });
  }

  if (/\b(stop|end|cancel)\s+(translation|translate|interpreter)\b/.test(normalized)) {
    return result({ name: 'stop_translation', confidence: 0.99, command: clean, normalized, args: {}, spokenSummary: 'Stop live translation.' });
  }

  const language = parseLanguage(clean);
  if (language) {
    return result({
      name: 'start_translation',
      confidence: 0.98,
      command: clean,
      normalized,
      args: { targetLanguage: language },
      spokenSummary: `Start live translation to ${language}.`,
    });
  }

  if (/\b(stop listening|sleep|go quiet|microphone off)\b/.test(normalized)) {
    return result({ name: 'stop_listening', confidence: 0.97, command: clean, normalized, args: {}, spokenSummary: 'Stop continuous listening.' });
  }

  if (/\b(start listening|keep listening|wake up|microphone on)\b/.test(normalized)) {
    return result({ name: 'start_listening', confidence: 0.97, command: clean, normalized, args: {}, spokenSummary: 'Start continuous listening.' });
  }

  if (mediaControlWords.some((word) => normalized.includes(word))) {
    return result({
      name: 'media_control',
      confidence: 0.9,
      command: clean,
      normalized,
      args: { action: normalized, volume: parseVolume(clean) },
      spokenSummary: 'Control current media.',
    });
  }

  if (/\b(open|watch|youtube|video)\b/.test(normalized) && !/\bmusic\b/.test(normalized)) {
    const query = extractAfter(clean, ['open youtube', 'youtube', 'watch', 'play video', 'open video', 'video']);
    return result({
      name: 'youtube_search',
      confidence: 0.92,
      command: clean,
      normalized,
      args: { query: query || clean },
      spokenSummary: `Open YouTube for ${query || clean}.`,
    });
  }

  if (/\b(play|start|open)\b/.test(normalized) && /\b(music|song|track|playlist|audio)\b/.test(normalized)) {
    const query = extractAfter(clean, ['play music', 'play song', 'play track', 'music', 'song', 'track', 'playlist']);
    return result({
      name: 'play_music',
      confidence: 0.92,
      command: clean,
      normalized,
      args: { query: query || 'relaxing music' },
      spokenSummary: `Play music for ${query || 'relaxing music'}.`,
    });
  }

  if (/\b(change|set|switch)\b/.test(normalized) && /\b(style|voice|personality)\b/.test(normalized)) {
    return result({ name: 'configure_voice', confidence: 0.91, command: clean, normalized, args: {}, spokenSummary: 'Update voice or personality.' });
  }

  if (/\bwake word\b/.test(normalized)) {
    const match = clean.match(/wake word\s+(?:to|is|as)\s+(.+)$/i);
    const wakeWord = cleanCommand(match?.[1] ?? 'aga').split(' ').slice(0, 3).join(' ');
    return result({
      name: 'configure_wake_word',
      confidence: 0.94,
      command: clean,
      normalized,
      args: { wakeWord: wakeWord || 'aga' },
      spokenSummary: `Set wake word to ${wakeWord || 'AGA'}.`,
    });
  }

  if (/\b(call yourself|your name|rename yourself)\b/.test(normalized)) {
    const match = clean.match(/(?:call yourself|your name is|rename yourself)\s+(.+)$/i);
    const assistantName = cleanCommand(match?.[1] ?? 'AGA').split(' ')[0] || 'AGA';
    return result({
      name: 'configure_name',
      confidence: 0.94,
      command: clean,
      normalized,
      args: { assistantName },
      spokenSummary: `Rename assistant to ${assistantName}.`,
    });
  }

  if (/\b(clear|reset)\b/.test(normalized) && /\b(chat|conversation|screen|memory)\b/.test(normalized)) {
    return result({
      name: 'reset_conversation',
      confidence: 0.9,
      command: clean,
      normalized,
      args: {},
      spokenSummary: 'Reset the current conversation.',
      needsConfirmation: /\b(memory|history)\b/.test(normalized),
    });
  }

  if (/\b(agent|research|plan|build|debug|complex task|multi step|spawn)\b/.test(normalized)) {
    return result({
      name: 'agent_task',
      confidence: 0.72,
      command: clean,
      normalized,
      args: { goal: clean },
      spokenSummary: 'Run an on-demand agent task.',
      needsConfirmation: false,
    });
  }

  return result({
    name: 'chat',
    confidence: 0.78,
    command: clean,
    normalized,
    args: { message: clean },
    spokenSummary: 'Continue the conversation.',
  });
}
