import type { Preferences } from '../db/localStore';
import { getRemoteToolDefinitions } from '../remote/config';

export type JsonObject = Record<string, unknown>;

export type RealtimeToolDefinition = {
  type: 'function';
  name: string;
  description: string;
  parameters: JsonObject;
};

function schema(properties: JsonObject, required: string[] = []): JsonObject {
  return { type: 'object', properties, required };
}

/**
 * Single built-in capability contract.
 *
 * Realtime, future offline parsing, and remote config should all derive tool
 * names + schemas from this list. Do not re-declare built-in tools inline in
 * engine files. Remote/server tools are appended separately by remote/config.
 */
export const BUILTIN_CAPABILITY_TOOLS: readonly RealtimeToolDefinition[] = [
  {
    type: 'function',
    name: 'get_time',
    description: 'Get the current local date/time for the AGA device or a named time zone.',
    parameters: schema({
      timeZone: { type: 'string', description: 'Optional IANA time zone, for example Asia/Makassar or Europe/London.' },
      format: { type: 'string', enum: ['spoken', 'iso', 'debug'], description: 'spoken is best for voice replies.' },
    }),
  },
  {
    type: 'function',
    name: 'get_weather',
    description: 'Get current weather for the device home location, browser geolocation, or explicit latitude/longitude.',
    parameters: schema({
      latitude: { type: 'number' },
      longitude: { type: 'number' },
      label: { type: 'string', description: 'Human label for the location.' },
      unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
    }),
  },
  {
    type: 'function',
    name: 'remember',
    description: 'Persist a durable fact about the user for future sessions.',
    parameters: schema({ text: { type: 'string' } }, ['text']),
  },
  {
    type: 'function',
    name: 'recall',
    description: 'Search saved memories. Omit query to list recent memories.',
    parameters: schema({ query: { type: 'string' } }),
  },
  {
    type: 'function',
    name: 'start_new_conversation_session',
    description: 'Start a fresh ephemeral conversation session. This clears only the current transcript/session context; durable memories, reminders, voice, server config, and personality settings stay.',
    parameters: schema({
      reason: { type: 'string', description: 'Short reason, for example user_requested, wake_reactivation, or reset_context.' },
      endActiveSkill: { type: 'boolean', description: 'Whether to end any active guided skill overlay. Default true for a truly fresh session.' },
    }),
  },
  {
    type: 'function',
    name: 'forget_user_data',
    description: 'Reset AGA data. Use scope=session for fresh context only. Use scope=personalization to forget memories/profile/personality. Use scope=everything only after the user confirms by saying yes forget everything.',
    parameters: schema({
      scope: { type: 'string', enum: ['session', 'personalization', 'everything'] },
      confirmation: { type: 'string', description: 'For destructive scopes, include the user spoken confirmation. Must contain yes and forget.' },
    }, ['scope']),
  },
  {
    type: 'function',
    name: 'set_reminder',
    description: 'Schedule a reminder. when_iso must be an absolute ISO-8601 timestamp; resolve relative time before calling.',
    parameters: schema({ text: { type: 'string' }, when_iso: { type: 'string' } }, ['text', 'when_iso']),
  },
  {
    type: 'function',
    name: 'list_reminders',
    description: 'List pending reminders.',
    parameters: schema({}),
  },
  {
    type: 'function',
    name: 'clear_reminders',
    description: 'Delete all reminders and cancel their notifications.',
    parameters: schema({}),
  },
  {
    type: 'function',
    name: 'play_youtube',
    description: 'Play background media. For broad music/ambient requests, use generated local ambient audio. Use YouTube only for explicit YouTube URLs/searches or when forceYouTube is true.',
    parameters: schema({
      query: { type: 'string' },
      forceYouTube: { type: 'boolean', description: 'Only true when the user explicitly wants YouTube instead of local ambient.' },
    }, ['query']),
  },
  {
    type: 'function',
    name: 'media_control',
    description: 'Control current playback.',
    parameters: schema({ command: { type: 'string', enum: ['pause', 'resume', 'stop'] } }, ['command']),
  },
  {
    type: 'function',
    name: 'set_listening_mode',
    description: 'Change hot-mic sensitivity and whether interruption is allowed.',
    parameters: schema({
      mode: { type: 'string', enum: ['strict', 'answer_window', 'handsfree'] },
      allow_barge_in: { type: 'boolean' },
    }, ['mode']),
  },
  {
    type: 'function',
    name: 'set_persona',
    description: 'Switch voice persona: warm, calm, bright, coach, whisper.',
    parameters: schema({ persona: { type: 'string' } }, ['persona']),
  },
  {
    type: 'function',
    name: 'set_translate',
    description: 'Turn live phrase translation on with a target language, or off with null.',
    parameters: schema({ target: { type: ['string', 'null'] } }, ['target']),
  },
  {
    type: 'function',
    name: 'show_settings_menu',
    description: 'Show a spoken-choice menu. Use for voice, personality, skills, listening, language, imagination, or sessions.',
    parameters: schema({
      category: { type: 'string', enum: ['main', 'voice', 'personality', 'session', 'language', 'imagination', 'skills', 'listening', 'sensitivity'] },
    }),
  },
  {
    type: 'function',
    name: 'choose_option',
    description: 'Choose an option from the currently visible AGA menu by number, letter, or spoken option name.',
    parameters: schema({ choice: { type: 'string' } }, ['choice']),
  },
  {
    type: 'function',
    name: 'set_voice',
    description: 'Change the realtime voice directly.',
    parameters: schema({ voice: { type: 'string' } }, ['voice']),
  },
  {
    type: 'function',
    name: 'regenerate_personality',
    description: 'Generate or select a fresh custom personality overlay for AGA.',
    parameters: schema({ style: { type: 'string' } }),
  },
  {
    type: 'function',
    name: 'start_session',
    description: 'Start a special AGA skill/session. Server-managed skills should usually be started through the skills menu.',
    parameters: schema({
      kind: { type: 'string', enum: ['language', 'imagination', 'advice', 'focus', 'bedtime', 'breathing', 'music', 'general'] },
      label: { type: 'string' },
      targetLanguage: { type: 'string' },
      theme: { type: 'string' },
    }, ['kind']),
  },


  {
    type: 'function',
    name: 'start_skill',
    description: 'Start any skill from the unified registry. This covers builtin guided sessions, remote skills, and learned skills.',
    parameters: schema({
      idOrAlias: { type: 'string', description: 'Skill id, label, alias, or natural description.' },
      goal: { type: 'string', description: 'Optional user goal/theme for this run.' },
    }, ['idOrAlias']),
  },
  {
    type: 'function',
    name: 'create_learned_skill',
    description: 'Save a reusable learned skill/scenario after the user asks AGA to learn a new skill or after explicit consent.',
    parameters: schema({
      label: { type: 'string' },
      aliases: { type: 'array', items: { type: 'string' } },
      instructions: { type: 'string', description: 'Voice-first instructions for how to run this skill safely.' },
      tools: { type: 'array', items: { type: 'string' } },
      confidence: { type: 'number' },
    }, ['label', 'instructions']),
  },
  {
    type: 'function',
    name: 'propose_learned_routine',
    description: 'Propose a learned routine from an observed pattern. Do not enable automation until the user accepts it by voice.',
    parameters: schema({
      title: { type: 'string' },
      prompt: { type: 'string' },
      timeOfDay: { type: 'string' },
      trigger: { type: 'object' },
      action: { type: 'object' },
      confidence: { type: 'number' },
    }, ['title', 'prompt']),
  },
  {
    type: 'function',
    name: 'start_guided_session',
    description: 'Start a structured guided session such as breathing, body scan, self-hypnosis, conflict navigation, meditation, bedtime, or imagination work.',
    parameters: schema({
      kind: { type: 'string', enum: ['breathing', 'body_scan', 'self_hypnosis', 'conflict_navigation', 'imagination', 'music', 'language', 'focus', 'bedtime', 'general'] },
      goal: { type: 'string', description: 'Optional user goal, theme, or issue for the guided session.' },
      durationMinutes: { type: 'number' },
    }, ['kind']),
  },
  {
    type: 'function',
    name: 'guided_session_control',
    description: 'Control the active guided session: pause, resume, deeper, skip, repeat, or end.',
    parameters: schema({ command: { type: 'string', enum: ['pause', 'resume', 'deeper', 'skip', 'repeat', 'end'] } }, ['command']),
  },
  {
    type: 'function',
    name: 'get_user_profile',
    description: 'Read the durable user profile summary: goals, preferred guidance style, useful techniques, and patterns.',
    parameters: schema({}),
  },
  {
    type: 'function',
    name: 'update_user_profile',
    description: 'Persist a concise observation about what helps this user, their goals, rituals, or recurring emotional patterns.',
    parameters: schema({
      note: { type: 'string' },
      goal: { type: 'string' },
      technique: { type: 'string' },
      emotionalPattern: { type: 'string' },
      ritual: { type: 'string' },
      communicationStyle: { type: 'string' },
    }),
  },
  {
    type: 'function',
    name: 'reflect_session',
    description: 'After a meaningful guided or emotional session, save a short reflection about what worked and what should be remembered for future guidance.',
    parameters: schema({
      summary: { type: 'string' },
      technique: { type: 'string' },
      goal: { type: 'string' },
      emotionalPattern: { type: 'string' },
      nextRitual: { type: 'string' },
    }, ['summary']),
  },
  {
    type: 'function',
    name: 'refresh_remote_config',
    description: 'Pull the latest server-controlled settings, skills, labels, images, and remote tools now.',
    parameters: schema({}),
  },
  {
    type: 'function',
    name: 'end_session',
    description: 'End the current special session and return to normal guardian mode.',
    parameters: schema({}),
  },
] as const;

export function getRealtimeCapabilityToolDefinitions() {
  return [...BUILTIN_CAPABILITY_TOOLS, ...getRemoteToolDefinitions()];
}

export function buildTurnContextBlock(prefs: Preferences | null) {
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  const currentConversation = (prefs as any)?.currentConversation;
  const profile = (prefs as any)?.userProfile;
  const profileLines = profile && typeof profile === 'object' ? [
    Array.isArray((profile as any).goals) && (profile as any).goals.length ? `Known goals: ${(profile as any).goals.slice(-4).join('; ')}` : '',
    Array.isArray((profile as any).effectiveTechniques) && (profile as any).effectiveTechniques.length ? `Helpful techniques: ${(profile as any).effectiveTechniques.slice(-4).join('; ')}` : '',
    (profile as any).communicationStyle ? `Preferred communication style: ${(profile as any).communicationStyle}` : '',
  ].filter(Boolean) : [];
  const parts = [
    `Device time now: ${now.toISOString()} (${timeZone}).`,
    currentConversation ? `Fresh conversation session: ${(currentConversation as any).id}, started ${(currentConversation as any).startedAt}, generation ${(currentConversation as any).generation}.` : 'No conversation session id yet; treat this activation as fresh.',
    'Conversation policy: every wake/duplex activation is fresh ephemeral context. Do not rely on old transcript unless durable memories/profile are provided. For durable facts call remember/update_user_profile/reflect_session.',
    'Language policy: mirror the language of the latest user utterance in this activation. Ignore browser/device locale and stale memories when choosing reply language. Default wake-only greetings to English.',
    'If the user says start over, new session, or reset context, call start_new_conversation_session. If the user says forget everything, call forget_user_data and require voice confirmation before destructive wipe.',
    'Use get_time for time/date questions instead of guessing.',
    'Use get_weather for weather questions instead of guessing.',
    'Use get_user_profile before deep coaching, hypnosis, conflict navigation, or habit advice. Use update_user_profile/reflect_session after meaningful guidance.',
    ...profileLines,
  ];
  const lat = (prefs as any)?.homeLatitude;
  const lon = (prefs as any)?.homeLongitude;
  if (typeof lat === 'number' && typeof lon === 'number') {
    parts.push(`Configured home weather coordinates: ${lat}, ${lon}${(prefs as any)?.homeLabel ? ` (${(prefs as any).homeLabel})` : ''}.`);
  } else {
    parts.push('No home weather coordinates are configured; get_weather may request browser/device geolocation when available.');
  }
  return parts.join('\n');
}

export async function runGetTimeCapability(args: JsonObject = {}) {
  const timeZone = typeof args.timeZone === 'string' && args.timeZone.trim() ? args.timeZone.trim() : undefined;
  const now = new Date();
  const format = String(args.format || 'spoken');
  if (format === 'iso') return now.toISOString();
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  };
  const label = new Intl.DateTimeFormat(undefined, options).format(now);
  return `It is ${label}.`;
}

function prefNumber(prefs: Preferences | null, key: string) {
  const value = (prefs as any)?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function browserCoords(timeoutMs = 4500): Promise<{ latitude: number; longitude: number; label?: string } | null> {
  const root: any = globalThis as any;
  const geolocation = root?.navigator?.geolocation;
  if (!geolocation?.getCurrentPosition) return null;
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; resolve(null); }
    }, timeoutMs);
    geolocation.getCurrentPosition(
      (pos: any) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, label: 'your location' });
      },
      () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 15 * 60_000 },
    );
  });
}

function weatherCodeSummary(code: number) {
  if (code === 0) return 'clear sky';
  if ([1, 2, 3].includes(code)) return 'partly cloudy';
  if ([45, 48].includes(code)) return 'foggy';
  if ([51, 53, 55, 56, 57].includes(code)) return 'drizzly';
  if ([61, 63, 65, 66, 67].includes(code)) return 'rainy';
  if ([71, 73, 75, 77].includes(code)) return 'snowy';
  if ([80, 81, 82].includes(code)) return 'showery';
  if ([95, 96, 99].includes(code)) return 'stormy';
  return 'mixed weather';
}

export async function runGetWeatherCapability(args: JsonObject = {}, prefs: Preferences | null = null) {
  const unit = String(args.unit || (prefs as any)?.temperatureUnit || 'celsius').toLowerCase();
  let latitude = typeof args.latitude === 'number' ? args.latitude : prefNumber(prefs, 'homeLatitude');
  let longitude = typeof args.longitude === 'number' ? args.longitude : prefNumber(prefs, 'homeLongitude');
  let label = typeof args.label === 'string' && args.label.trim() ? args.label.trim() : (prefs as any)?.homeLabel || 'home';

  if (latitude == null || longitude == null) {
    const geo = await browserCoords();
    if (geo) {
      latitude = geo.latitude;
      longitude = geo.longitude;
      label = geo.label || label;
    }
  }

  if (latitude == null || longitude == null) {
    return 'I do not have a weather location yet. Set home latitude and longitude in the server config, or allow location access on this device.';
  }

  const tempUnit = unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&temperature_unit=${tempUnit}`;
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data?.reason || data?.error || 'Weather request failed.');
  const current = data?.current || {};
  const temp = Math.round(Number(current.temperature_2m));
  const feels = Math.round(Number(current.apparent_temperature));
  const wind = Math.round(Number(current.wind_speed_10m));
  const condition = weatherCodeSummary(Number(current.weather_code));
  const unitLabel = tempUnit === 'fahrenheit' ? 'degrees Fahrenheit' : 'degrees Celsius';
  return `Weather for ${label}: ${condition}, ${temp} ${unitLabel}, feels like ${feels}, with wind around ${wind} kilometers per hour.`;
}