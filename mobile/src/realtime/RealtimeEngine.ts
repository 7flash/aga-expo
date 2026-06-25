import { AGA_TOOLS, getRealtimeToolDefinitions, toolCallToAction, type AgaToolCall } from '../aga/tools';
import { createRealtimeSession } from './session';
import type { AgaAction } from '../aga/turn';
import { measureAsync, measureMark } from '../observability/measure';

export type RealtimeEvent =
  | { type: 'status'; status: string }
  | { type: 'speech'; text: string }
  | { type: 'action'; action: AgaAction }
  | { type: 'error'; message: string };

export type RealtimeEngineOptions = {
  model?: string;
  sessionUrl?: string;
  clientSecret?: string;
  onEvent: (event: RealtimeEvent) => void;
};

function realtimeEnabled() {
  return process.env.EXPO_PUBLIC_AGA_REALTIME_ENABLED === '1';
}

function defaultModel() {
  return process.env.EXPO_PUBLIC_OPENAI_REALTIME_MODEL || 'gpt-realtime-2';
}

/**
 * Feature-flagged Realtime adapter.
 *
 * This deliberately does not replace the local parser. Local turn-based voice is
 * the fallback and test oracle. When an ephemeral session is provided, this
 * adapter registers AGA tools and converts model tool calls back into the same
 * local AgaAction union used everywhere else.
 */
export class RealtimeEngine {
  private socket: any | null = null;
  private options: RealtimeEngineOptions;

  constructor(options: RealtimeEngineOptions) {
    this.options = options;
  }

  isConfigured() {
    return realtimeEnabled() && Boolean(
      this.options.clientSecret ||
      process.env.EXPO_PUBLIC_AGA_REALTIME_CLIENT_SECRET ||
      process.env.EXPO_PUBLIC_OPENAI_API_KEY ||
      process.env.EXPO_PUBLIC_AGA_REALTIME_SESSION_URL
    );
  }

  async start() {
    return measureAsync('realtime.start', async () => {
      if (!this.isConfigured()) {
        this.options.onEvent({ type: 'status', status: 'realtime disabled; using local turn engine' });
        return false;
      }

      const session = this.options.clientSecret
        ? null
        : await createRealtimeSession();
      const secret = this.options.clientSecret || session?.clientSecret || process.env.EXPO_PUBLIC_AGA_REALTIME_CLIENT_SECRET || process.env.EXPO_PUBLIC_OPENAI_API_KEY || '';
      const model = this.options.model || session?.model || defaultModel();
      if (!secret) {
        this.options.onEvent({ type: 'status', status: 'realtime session unavailable; using local turn engine' });
        return false;
      }
      const url = this.options.sessionUrl || `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
      const WS: any = WebSocket as any;
      this.socket = new WS(url, [], {
        headers: {
          Authorization: `Bearer ${secret}`, // direct APK key support for dev/device builds
        },
      });

      this.socket.onopen = () => {
        this.options.onEvent({ type: 'status', status: 'realtime connected' });
        this.send({
          type: 'session.update',
          session: {
            type: 'realtime',
            model,
            modalities: ['text', 'audio'],
            audio: { output: { voice: process.env.EXPO_PUBLIC_OPENAI_REALTIME_VOICE || 'alloy' } },
            reasoning: { effort: process.env.EXPO_PUBLIC_OPENAI_REALTIME_REASONING_EFFORT || 'low' },
            instructions: 'You are AGA, a warm guardian angel voice companion. Be concise, practical, and caring. Use tools for device actions.',
            tools: getRealtimeToolDefinitions(),
          },
        });
        measureMark('realtime.open', { tools: AGA_TOOLS.length });
      };

      this.socket.onerror = () => {
        this.options.onEvent({ type: 'error', message: 'Realtime socket error; local fallback remains available.' });
      };

      this.socket.onmessage = (message) => this.handleMessage(String(message.data ?? ''));
      this.socket.onclose = () => this.options.onEvent({ type: 'status', status: 'realtime closed' });
      return true;
    });
  }

  stop() {
    this.socket?.close?.();
    this.socket = null;
  }

  send(value: unknown) {
    if (!this.socket || this.socket.readyState !== 1) return false;
    this.socket.send(JSON.stringify(value));
    return true;
  }

  private handleMessage(raw: string) {
    measureMark('realtime.message');
    let data: any;
    try { data = JSON.parse(raw); } catch { return; }

    const text = data?.response?.output_text || data?.text || data?.delta;
    if (typeof text === 'string' && text.trim()) {
      this.options.onEvent({ type: 'speech', text: text.trim() });
    }

    const toolCalls: AgaToolCall[] = [];
    if (data?.type?.includes?.('function_call')) {
      toolCalls.push({ name: data.name ?? data.call?.name, arguments: data.arguments ?? data.call?.arguments });
    }
    if (data?.tool_call) toolCalls.push({ name: data.tool_call.name, arguments: data.tool_call.arguments });
    for (const item of data?.response?.output ?? []) {
      if (item?.type === 'function_call') toolCalls.push({ name: item.name, arguments: item.arguments });
    }
    for (const call of toolCalls) {
      if (!call?.name) continue;
      const action = toolCallToAction(call);
      if (action) this.options.onEvent({ type: 'action', action });
    }
  }
}
