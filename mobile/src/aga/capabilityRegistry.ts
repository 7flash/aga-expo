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
    description: 'Search YouTube or use safe presets and start playback of the best match.',
    parameters: schema({ query: { type: 'string' } }, ['query']),
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
  const parts = [
    `Device time now: ${now.toISOString()} (${timeZone}).`,
    'Use get_time for time/date questions instead of guessing.',
    'Use get_weather for weather questions instead of guessing.',
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
