import { loadPreferences, logEvent, savePreferences, type Preferences } from '../db/localStore';
import { emitObservation } from './observability';

type JsonObject = Record<string, unknown>;

export type RemoteSkill = {
  id: string;
  label: string;
  description?: string;
  aliases?: string[];
  instructions: string;
  kind?: 'remote' | 'language' | 'imagination' | 'advice' | 'focus' | 'bedtime' | 'breathing' | 'music' | 'general';
  targetLanguage?: string | null;
  theme?: string | null;
  iconUrl?: string | null;
  imageUrl?: string | null;
  enabled?: boolean;
  priority?: number;
  toolNames?: string[];
};

export type RemoteTool = {
  name: string;
  description: string;
  parameters?: JsonObject;
  endpoint?: string;
  enabled?: boolean;
  timeoutMs?: number;
};

export type RemoteConfig = {
  schemaVersion?: number;
  revision?: string;
  deviceLabel?: string;
  pollMs?: number;
  labels?: Record<string, string>;
  images?: Record<string, string>;
  settings?: Partial<Preferences> & {
    model?: string;
    realtimeModel?: string;
    realtimeVoice?: string;
    personalityPrompt?: string | null;
  };
  realtime?: {
    model?: string;
    voice?: string;
    instructions?: string;
    strictWake?: boolean;
    allowBargeIn?: boolean;
    listenMode?: 'strict' | 'answer_window' | 'handsfree';
  };
  skills?: RemoteSkill[];
  tools?: RemoteTool[];
  observability?: {
    endpoint?: string;
    sampleRate?: number;
  };
  updates?: {
    ota?: 'off' | 'check' | 'fetch' | 'fetch_and_reload';
    requiredRevision?: string;
    message?: string;
    apkUrl?: string;
    apkVersion?: string;
    nativeUpdateRequired?: boolean;
  };
};

type RemoteState = {
  config: RemoteConfig;
  lastFetchedAt: string | null;
  lastError: string | null;
  stopPoller: (() => void) | null;
};

const DEFAULT_CONFIG: RemoteConfig = { schemaVersion: 1, revision: 'local', skills: [], tools: [] };
const state: RemoteState = { config: DEFAULT_CONFIG, lastFetchedAt: null, lastError: null, stopPoller: null };

function env(name: string) {
  return process.env?.[name] ?? '';
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function arrayOfStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, 24);
}

function sanitizeId(value: unknown, fallback: string) {
  const raw = String(value ?? fallback).trim().toLowerCase();
  return raw.replace(/[^a-z0-9_.-]/g, '-').replace(/-+/g, '-').slice(0, 80) || fallback;
}

function sanitizeFunctionName(value: unknown) {
  const raw = String(value ?? '').trim();
  const clean = raw.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^([^a-zA-Z_])/, '_$1').slice(0, 64);
  return clean || null;
}

function sanitizeSkill(raw: unknown, index: number): RemoteSkill | null {
  if (!isObject(raw)) return null;
  if (raw.enabled === false) return null;
  const label = stringOrNull(raw.label) ?? stringOrNull(raw.title) ?? `Server skill ${index + 1}`;
  const instructions = stringOrNull(raw.instructions) ?? stringOrNull(raw.prompt) ?? '';
  if (!instructions) return null;
  return {
    id: sanitizeId(raw.id, `remote-skill-${index + 1}`),
    label,
    description: stringOrNull(raw.description) ?? undefined,
    aliases: arrayOfStrings(raw.aliases),
    instructions,
    kind: (['remote', 'language', 'imagination', 'advice', 'focus', 'bedtime', 'breathing', 'music', 'general'].includes(String(raw.kind)) ? raw.kind : 'remote') as RemoteSkill['kind'],
    targetLanguage: stringOrNull(raw.targetLanguage) ?? stringOrNull(raw.target_language),
    theme: stringOrNull(raw.theme),
    iconUrl: stringOrNull(raw.iconUrl) ?? stringOrNull(raw.icon_url),
    imageUrl: stringOrNull(raw.imageUrl) ?? stringOrNull(raw.image_url),
    priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : index,
    toolNames: arrayOfStrings(raw.toolNames ?? raw.tools),
  };
}

function sanitizeTool(raw: unknown): RemoteTool | null {
  if (!isObject(raw)) return null;
  if (raw.enabled === false) return null;
  const name = sanitizeFunctionName(raw.name);
  const description = stringOrNull(raw.description) ?? stringOrNull(raw.summary) ?? '';
  if (!name || !description) return null;
  return {
    name,
    description,
    parameters: isObject(raw.parameters) ? raw.parameters : { type: 'object', properties: {} },
    endpoint: stringOrNull(raw.endpoint) ?? undefined,
    timeoutMs: Number.isFinite(Number(raw.timeoutMs)) ? Number(raw.timeoutMs) : undefined,
  };
}

function sanitizeConfig(input: unknown): RemoteConfig {
  if (!isObject(input)) return DEFAULT_CONFIG;
  const skills = Array.isArray(input.skills) ? input.skills.map(sanitizeSkill).filter(Boolean) as RemoteSkill[] : [];
  const tools = Array.isArray(input.tools) ? input.tools.map(sanitizeTool).filter(Boolean) as RemoteTool[] : [];
  const settings = isObject(input.settings) ? input.settings as Partial<Preferences> : undefined;
  const realtime = isObject(input.realtime) ? input.realtime as RemoteConfig['realtime'] : undefined;
  const observability = isObject(input.observability) ? input.observability as RemoteConfig['observability'] : undefined;
  const updates = isObject(input.updates) ? input.updates as RemoteConfig['updates'] : undefined;
  const labels = isObject(input.labels) ? Object.fromEntries(Object.entries(input.labels).map(([k, v]) => [k, String(v ?? '')])) : undefined;
  const images = isObject(input.images) ? Object.fromEntries(Object.entries(input.images).map(([k, v]) => [k, String(v ?? '')])) : undefined;
  return {
    schemaVersion: Number.isFinite(Number(input.schemaVersion)) ? Number(input.schemaVersion) : 1,
    revision: stringOrNull(input.revision) ?? stringOrNull(input.version) ?? String(Date.now()),
    deviceLabel: stringOrNull(input.deviceLabel) ?? stringOrNull(input.device_label) ?? undefined,
    pollMs: Number.isFinite(Number(input.pollMs)) ? Math.max(15_000, Number(input.pollMs)) : undefined,
    labels,
    images,
    settings,
    realtime,
    skills: skills.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)).slice(0, 32),
    tools: tools.slice(0, 32),
    observability,
    updates,
  };
}

export function getRemoteConfigUrl() {
  return env('EXPO_PUBLIC_AGA_CONFIG_URL') || env('EXPO_PUBLIC_TRADJS_CONFIG_URL') || env('EXPO_PUBLIC_REMOTE_CONFIG_URL');
}

export function getRemoteConfig() {
  return state.config;
}

export function getRemoteConfigRevision() {
  return state.config.revision ?? 'local';
}

export function getRemoteSkills() {
  return (state.config.skills ?? []).filter((skill) => skill.enabled !== false);
}

export function getRemoteTools() {
  return (state.config.tools ?? []).filter((tool) => tool.enabled !== false);
}

export function remoteConfigPromptBlock() {
  const cfg = getRemoteConfig();
  const parts: string[] = [];
  if (cfg.deviceLabel) parts.push(`Device label: ${cfg.deviceLabel}.`);
  if (cfg.realtime?.instructions) parts.push(`Server instructions: ${cfg.realtime.instructions}`);
  if (cfg.labels && Object.keys(cfg.labels).length) parts.push(`Server labels: ${Object.entries(cfg.labels).slice(0, 12).map(([k, v]) => `${k}=${v}`).join(', ')}.`);
  if (cfg.skills?.length) parts.push(`Server skills available: ${cfg.skills.map((skill) => skill.label).join(', ')}.`);
  return parts.join('\n');
}

function remotePrefsPatch(config: RemoteConfig, current: Preferences): Partial<Preferences> {
  const patch: Partial<Preferences> = {};
  const settings = config.settings ?? {};
  for (const key of ['wakePhrase', 'persona', 'voiceLocale', 'translateTarget', 'showDiagnostics', 'proactiveReminders', 'realtimeVoice', 'personalityPrompt', 'realtimeListenMode', 'allowBargeIn', 'mediaDuckingEnabled'] as const) {
    if ((settings as any)[key] !== undefined) (patch as any)[key] = (settings as any)[key];
  }
  if (config.realtime?.voice) patch.realtimeVoice = config.realtime.voice;
  if (config.realtime?.listenMode) patch.realtimeListenMode = config.realtime.listenMode;
  if (typeof config.realtime?.allowBargeIn === 'boolean') patch.allowBargeIn = config.realtime.allowBargeIn;
  if (config.revision) (patch as any).remoteConfigRevision = config.revision;
  if (config.deviceLabel) (patch as any).deviceLabel = config.deviceLabel;
  if (config.pollMs) (patch as any).remoteConfigPollMs = config.pollMs;
  if (config.labels) (patch as any).serverLabels = config.labels;
  if (config.images) (patch as any).serverImages = config.images;
  return patch;
}

export async function applyRemoteConfig(config: RemoteConfig, reason = 'manual') {
  const sanitized = sanitizeConfig(config);
  const previousRevision = state.config.revision;
  state.config = sanitized;
  state.lastFetchedAt = new Date().toISOString();
  state.lastError = null;
  const prefs = await loadPreferences();
  const patch = remotePrefsPatch(sanitized, prefs);
  if (Object.keys(patch).length) await savePreferences(patch);
  await logEvent('remote.config.apply', `${reason}: ${sanitized.revision ?? 'unknown'}`);
  emitObservation('remote_config', 'apply', { reason, revision: sanitized.revision, previousRevision, skills: sanitized.skills?.length ?? 0, tools: sanitized.tools?.length ?? 0 });
  return sanitized;
}

export async function fetchRemoteConfig(reason = 'poll') {
  const url = getRemoteConfigUrl();
  if (!url) return null;
  const prefs = await loadPreferences().catch(() => null);
  const root: any = globalThis as any;
  const base = root?.location?.origin || 'http://localhost';
  const absolute = new URL(url, /^https?:/i.test(url) ? undefined : base);
  absolute.searchParams.set('reason', reason);
  absolute.searchParams.set('revision', String((prefs as any)?.remoteConfigRevision ?? state.config.revision ?? 'local'));
  absolute.searchParams.set('deviceLabel', String((prefs as any)?.deviceLabel ?? env('EXPO_PUBLIC_AGA_DEVICE_LABEL') ?? 'aga-device'));
  const response = await fetch(absolute.toString(), { headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Remote config ${response.status}: ${JSON.stringify(data).slice(0, 180)}`);
  return sanitizeConfig(data);
}

export async function fetchAndApplyRemoteConfig(reason = 'poll') {
  try {
    const cfg = await fetchRemoteConfig(reason);
    if (!cfg) return null;
    return await applyRemoteConfig(cfg, reason);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'remote config failed');
    state.lastError = message;
    await logEvent('remote.config.error', message);
    emitObservation('remote_config', 'error', { reason, message });
    return null;
  }
}

export function startRemoteConfigPoller(onConfig?: (config: RemoteConfig) => void | Promise<void>) {
  if (state.stopPoller) state.stopPoller();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = async (reason: string) => {
    const cfg = await fetchAndApplyRemoteConfig(reason);
    if (cfg && onConfig) await onConfig(cfg);
    if (!stopped) {
      const interval = cfg?.pollMs ?? state.config.pollMs ?? Number(env('EXPO_PUBLIC_AGA_CONFIG_POLL_MS') || 60_000);
      timer = setTimeout(() => void tick('poll'), Math.max(15_000, interval));
    }
  };
  void tick('start');
  state.stopPoller = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return state.stopPoller;
}

export async function executeRemoteTool(name: string, args: Record<string, unknown>, context: Record<string, unknown> = {}) {
  const tool = getRemoteTools().find((item) => item.name === name);
  if (!tool) return `Unknown remote tool: ${name}`;
  const endpoint = tool.endpoint || getRemoteConfig().observability?.endpoint || env('EXPO_PUBLIC_AGA_TOOL_PROXY_URL');
  if (!endpoint) return `Remote tool ${name} has no endpoint configured.`;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = setTimeout(() => controller?.abort(), Math.max(1_000, tool.timeoutMs ?? 12_000));
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ tool: name, args, context, revision: getRemoteConfigRevision() }),
      signal: controller?.signal,
    } as any);
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error?.message || data?.message || `HTTP ${response.status}`);
    const output = data?.output ?? data?.result ?? data?.message ?? data;
    emitObservation('remote_tool', name, { ok: true });
    return typeof output === 'string' ? output : JSON.stringify(output).slice(0, 2000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'remote tool failed');
    emitObservation('remote_tool', name, { ok: false, message });
    return `Remote tool ${name} failed: ${message}`;
  } finally {
    clearTimeout(timeout);
  }
}

export function getRemoteToolDefinitions() {
  return getRemoteTools().map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters ?? { type: 'object', properties: {} },
  }));
}
