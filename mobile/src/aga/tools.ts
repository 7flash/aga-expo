import type { AgaAction } from './turn';

export type JsonSchema = {
  type: string;
  properties?: Record<string, JsonSchema | { type: string; description?: string; enum?: string[] }>;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
};

export type AgaToolSchema = {
  name: string;
  description: string;
  parameters: JsonSchema;
};

export type AgaToolCall = {
  name: string;
  arguments?: Record<string, unknown> | string | null;
};

function asString(value: unknown, max = 1000) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function parseArgs(value: AgaToolCall['arguments']) {
  if (!value) return {} as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' ? value : {};
}

export const AGA_TOOLS: AgaToolSchema[] = [
  {
    name: 'add_reminder',
    description: 'Schedule a local reminder for the user. Use an absolute ISO-8601 dueAt datetime.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'dueAt'],
      properties: {
        text: { type: 'string', description: 'What AGA should remind the user about.' },
        dueAt: { type: 'string', description: 'Absolute ISO-8601 datetime for the reminder.' },
      },
    },
  },
  {
    name: 'list_reminders',
    description: 'List pending reminders.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'clear_reminders',
    description: 'Clear all pending reminders.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'save_memory',
    description: "Save a useful, non-sensitive memory fact at the user's request.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: { text: { type: 'string', description: 'The memory fact to save.' } },
    },
  },
  {
    name: 'recall_memory',
    description: 'Recall memories, optionally filtered by query.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { query: { type: 'string', description: 'Optional memory search query.' } },
    },
  },
  {
    name: 'play_youtube',
    description: 'Pull up a YouTube video by natural language search query.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: { query: { type: 'string', description: 'The video or topic to play.' } },
    },
  },
  {
    name: 'media_control',
    description: 'Pause, resume, or stop current media.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['command'],
      properties: { command: { type: 'string', enum: ['pause', 'resume', 'stop'] } },
    },
  },
  {
    name: 'request_notifications',
    description: 'Request or verify local notification permission.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'set_persona',
    description: "Change AGA's voice/persona mode.",
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['persona'],
      properties: { persona: { type: 'string', enum: ['warm', 'calm', 'bright', 'coach', 'whisper'] } },
    },
  },
  {
    name: 'set_wake_phrase',
    description: 'Set a custom wake phrase.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['phrase'],
      properties: { phrase: { type: 'string' } },
    },
  },
  {
    name: 'translate_start',
    description: 'Start phrase translation mode.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['target'],
      properties: { target: { type: 'string', description: 'Target language.' } },
    },
  },
  {
    name: 'translate_stop',
    description: 'Stop phrase translation mode.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'status',
    description: 'Summarize local health/status.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
];

export function toolCallToAction(call: AgaToolCall): AgaAction | null {
  const name = asString(call.name, 80).toLowerCase();
  const args = parseArgs(call.arguments);

  switch (name) {
    case 'add_reminder': {
      const text = asString(args.text ?? args.title ?? args.body);
      const dueAt = asString(args.dueAt ?? args.due_at ?? args.datetime ?? args.when, 80);
      return text && dueAt ? { type: 'add_reminder', text, dueAt } : null;
    }
    case 'list_reminders':
      return { type: 'list_reminders' };
    case 'clear_reminders':
      return { type: 'clear_reminders' };
    case 'save_memory': {
      const text = asString(args.text ?? args.memory ?? args.content);
      return text ? { type: 'remember', text } : null;
    }
    case 'recall_memory': {
      const query = asString(args.query ?? args.text, 240);
      return query ? { type: 'recall', query } : { type: 'recall' };
    }
    case 'play_youtube': {
      const query = asString(args.query ?? args.text ?? args.title, 240);
      return query ? { type: 'play_youtube', query } : null;
    }
    case 'media_control': {
      const command = asString(args.command, 20).toLowerCase();
      if (command === 'pause') return { type: 'media_pause' };
      if (command === 'resume') return { type: 'media_resume' };
      if (command === 'stop') return { type: 'media_stop' };
      return null;
    }
    case 'request_notifications':
      return { type: 'request_notifications' };
    case 'set_persona': {
      const persona = asString(args.persona ?? args.mode ?? args.value, 80).toLowerCase();
      return persona ? { type: 'set_persona', persona } : null;
    }
    case 'set_wake_phrase': {
      const phrase = asString(args.phrase ?? args.value ?? args.text, 80).toLowerCase();
      return phrase ? { type: 'set_wake_phrase', phrase } : null;
    }
    case 'translate_start': {
      const target = asString(args.target ?? args.language ?? args.to, 80);
      return target ? { type: 'translate_start', target } : null;
    }
    case 'translate_stop':
      return { type: 'translate_stop' };
    case 'status':
      return { type: 'status' };
    default:
      return null;
  }
}

export function getRealtimeToolDefinitions() {
  return AGA_TOOLS.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}