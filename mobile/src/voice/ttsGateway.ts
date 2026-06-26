import { measureAsync, measureMark } from '../observability/measure';

export type TtsGatewayOptions = {
  text: string;
  voiceId?: string | null;
  modelId?: string | null;
  outputFormat?: string | null;
  emotion?: string | null;
  voiceSettings?: Record<string, unknown> | null;
  timeoutMs?: number;
};

export type TtsGatewayDiagnostics = {
  configured: boolean;
  starts: number;
  finishes: number;
  errors: number;
  lastError: string | null;
  lastLatencyMs: number | null;
  lastEndpoint: string | null;
};

const diagnostics: TtsGatewayDiagnostics = {
  configured: false,
  starts: 0,
  finishes: 0,
  errors: 0,
  lastError: null,
  lastLatencyMs: null,
  lastEndpoint: null,
};

function env(name: string) {
  return process.env?.[name] ?? '';
}

function cleanBaseUrl(url: string) {
  return url.trim().replace(/\/+$/, '');
}

export function getTtsGatewayUrl() {
  const explicit = cleanBaseUrl(env('EXPO_PUBLIC_AGA_TTS_GATEWAY_URL'));
  if (explicit) return explicit;
  const assistant = cleanBaseUrl(env('EXPO_PUBLIC_ASSISTANT_WEB_URL'));
  if (!assistant || assistant.includes('localhost')) return '';
  return `${assistant}/aga/tts/speech`;
}

export function isTtsGatewayConfigured() {
  return Boolean(getTtsGatewayUrl());
}

export function getTtsGatewayDiagnostics() {
  return { ...diagnostics, configured: isTtsGatewayConfigured() };
}

export async function fetchTtsGatewayAudio(options: TtsGatewayOptions) {
  return measureAsync('voice.tts.gateway.fetch', async () => {
    const endpoint = getTtsGatewayUrl();
    diagnostics.configured = Boolean(endpoint);
    diagnostics.lastEndpoint = endpoint || null;
    if (!endpoint) throw new Error('AGA TTS gateway is not configured.');
    const clean = String(options.text || '').replace(/\s+/g, ' ').trim();
    if (!clean) throw new Error('Cannot synthesize empty speech.');

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), options.timeoutMs ?? 18_000) : null;
    const started = Date.now();
    diagnostics.starts += 1;
    diagnostics.lastError = null;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'audio/mpeg,application/octet-stream',
          'x-aga-client': 'mobile',
        },
        body: JSON.stringify({
          text: clean,
          voiceId: options.voiceId || undefined,
          modelId: options.modelId || undefined,
          outputFormat: options.outputFormat || undefined,
          emotion: options.emotion || undefined,
          voiceSettings: options.voiceSettings || undefined,
        }),
        signal: controller?.signal,
      } as RequestInit);
      if (!response.ok) {
        const body = await response.text().catch(() => 'TTS gateway request failed');
        throw new Error(`AGA TTS gateway failed: ${body.slice(0, 240)}`);
      }
      const buffer = await response.arrayBuffer();
      diagnostics.finishes += 1;
      diagnostics.lastLatencyMs = Date.now() - started;
      measureMark('voice.tts.gateway.ok', { bytes: buffer.byteLength, latencyMs: diagnostics.lastLatencyMs });
      return buffer;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? 'TTS gateway failed');
      diagnostics.errors += 1;
      diagnostics.lastError = message;
      measureMark('voice.tts.gateway.error', { message });
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, { chars: options.text.length });
}
