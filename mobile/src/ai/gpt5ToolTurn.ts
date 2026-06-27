import { getRealtimeCapabilityToolDefinitions, buildTurnContextBlock, type JsonObject } from '../aga/capabilityRegistry';
import type { Preferences } from '../db/localStore';

export type ToolRunner = (name: string, args: JsonObject) => Promise<string>;

export type Gpt5ToolTurnOptions = {
  text: string;
  prefs: Preferences | null;
  memories?: string[];
  runTool: ToolRunner;
  maxToolCalls?: number;
};

function env(name: string) {
  return process.env?.[name] ?? '';
}

function apiKey() {
  return env('EXPO_PUBLIC_OPENAI_API_KEY') || env('OPENAI_API_KEY');
}

function model() {
  return env('EXPO_PUBLIC_OPENAI_REASONING_MODEL') || env('EXPO_PUBLIC_OPENAI_TEXT_MODEL') || 'gpt-5';
}

function toolDefs() {
  return getRealtimeCapabilityToolDefinitions().map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

function systemText(opts: Gpt5ToolTurnOptions) {
  const memoryBlock = opts.memories?.length
    ? `Relevant long-term context:
${opts.memories.map((m) => `- ${m}`).join('\n')}`
    : 'No relevant long-term context was retrieved.';
  return [
    'You are AGA, the Artificial Guardian Angel running on a no-touch Android appliance.',
    'Default path is short OpenAI STT, GPT-5 tool reasoning, then expressive ElevenLabs/OpenAI TTS.',
    'The router, not this prompt, decides whether this request is a short GPT-5 tool turn or a Gemini/OpenAI live session.',
    'Keep replies short, warm, and voice-first. Never mention buttons, tapping, typing, or touch controls.',
    'Use tools for time, weather, reminders, memory, media, settings, guided sessions, and profile updates.',
    buildTurnContextBlock(opts.prefs),
    memoryBlock,
  ].join('\n\n');
}

function extractText(data: any): string {
  if (typeof data?.output_text === 'string') return data.output_text.trim();
  const out = data?.output || data?.choices?.[0]?.message?.content || [];
  if (typeof out === 'string') return out.trim();
  if (Array.isArray(out)) {
    const chunks: string[] = [];
    for (const item of out) {
      if (typeof item?.text === 'string') chunks.push(item.text);
      if (typeof item?.content === 'string') chunks.push(item.content);
      if (Array.isArray(item?.content)) {
        for (const c of item.content) {
          if (typeof c?.text === 'string') chunks.push(c.text);
          if (typeof c?.text?.value === 'string') chunks.push(c.text.value);
        }
      }
    }
    return chunks.join(' ').replace(/\s+/g, ' ').trim();
  }
  return '';
}

function extractToolCalls(data: any): Array<{ id: string; name: string; arguments: JsonObject }> {
  const calls: Array<{ id: string; name: string; arguments: JsonObject }> = [];
  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    if (item?.type === 'function_call' || item?.type === 'tool_call') {
      let args: JsonObject = {};
      try { args = typeof item.arguments === 'string' ? JSON.parse(item.arguments) : (item.arguments || {}); } catch { args = {}; }
      calls.push({ id: String(item.call_id || item.id || `${item.name}-${calls.length}`), name: String(item.name || item.function?.name || ''), arguments: args });
    }
  }
  const legacy = data?.choices?.[0]?.message?.tool_calls;
  if (Array.isArray(legacy)) {
    for (const call of legacy) {
      let args: JsonObject = {};
      try { args = typeof call.function?.arguments === 'string' ? JSON.parse(call.function.arguments) : (call.function?.arguments || {}); } catch { args = {}; }
      calls.push({ id: String(call.id || `${call.function?.name}-${calls.length}`), name: String(call.function?.name || ''), arguments: args });
    }
  }
  return calls.filter((call) => call.name);
}

async function callResponses(body: JsonObject) {
  const key = apiKey();
  if (!key) throw new Error('Missing EXPO_PUBLIC_OPENAI_API_KEY for GPT-5 tool turn.');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || data?.message || 'OpenAI GPT tool turn failed.');
  return data;
}

export async function runGpt5ToolTurn(opts: Gpt5ToolTurnOptions): Promise<string> {
  const tools = toolDefs();
  const input: any[] = [
    { role: 'system', content: systemText(opts) },
    { role: 'user', content: opts.text },
  ];
  let data = await callResponses({ model: model(), input, tools, tool_choice: 'auto' });
  let toolCalls = extractToolCalls(data);
  const max = opts.maxToolCalls ?? 4;
  let used = 0;

  while (toolCalls.length && used < max) {
    const toolOutputs: any[] = [];
    for (const call of toolCalls) {
      used += 1;
      const output = await opts.runTool(call.name, call.arguments).catch((error: unknown) => error instanceof Error ? error.message : String(error || 'tool failed'));
      toolOutputs.push({ type: 'function_call_output', call_id: call.id, output });
    }

    // Prefer response continuation when available; fall back to replaying the
    // accumulated input plus function outputs for compatibility with wrappers.
    const body: any = data?.id
      ? { model: model(), previous_response_id: data.id, input: toolOutputs, tools, tool_choice: 'auto' }
      : { model: model(), input: [...input, ...toolOutputs], tools, tool_choice: 'auto' };
    data = await callResponses(body);
    toolCalls = extractToolCalls(data);
  }

  const text = extractText(data);
  return text || 'Done.';
}