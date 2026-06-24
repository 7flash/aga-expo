export type AgaState =
  | 'idle'
  | 'armed'
  | 'wake_confirmed'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'playing_media'
  | 'translating'
  | 'agent_running'
  | 'recovering'
  | 'offline';

export type AgaEvent =
  | { type: 'boot' }
  | { type: 'wake'; phrase?: string }
  | { type: 'listen' }
  | { type: 'speech_end'; text: string }
  | { type: 'reply' }
  | { type: 'speak_done' }
  | { type: 'media_start' }
  | { type: 'media_stop' }
  | { type: 'translate_start' }
  | { type: 'translate_stop' }
  | { type: 'agent_start' }
  | { type: 'agent_done' }
  | { type: 'recover' }
  | { type: 'offline' }
  | { type: 'online' }
  | { type: 'timeout' }
  | { type: 'stop' };

const table: Record<AgaState, Partial<Record<AgaEvent['type'], AgaState>>> = {
  idle: { boot: 'armed', wake: 'wake_confirmed', offline: 'offline' },
  armed: { wake: 'wake_confirmed', listen: 'listening', offline: 'offline' },
  wake_confirmed: { listen: 'listening', speech_end: 'thinking', timeout: 'armed', stop: 'armed' },
  listening: { speech_end: 'thinking', timeout: 'armed', stop: 'armed', offline: 'offline' },
  thinking: { reply: 'speaking', media_start: 'playing_media', translate_start: 'translating', agent_start: 'agent_running', recover: 'recovering', timeout: 'armed', offline: 'offline' },
  speaking: { speak_done: 'armed', wake: 'listening', media_start: 'playing_media', translate_start: 'translating', stop: 'armed', offline: 'offline' },
  playing_media: { wake: 'listening', media_stop: 'armed', stop: 'armed', offline: 'offline' },
  translating: { wake: 'listening', translate_stop: 'armed', stop: 'armed', offline: 'offline' },
  agent_running: { agent_done: 'speaking', wake: 'listening', stop: 'armed', recover: 'recovering', offline: 'offline' },
  recovering: { online: 'armed', timeout: 'armed', stop: 'armed', offline: 'offline' },
  offline: { online: 'armed', wake: 'offline', stop: 'offline' },
};

export function transition(state: AgaState, event: AgaEvent): AgaState {
  return table[state][event.type] ?? state;
}

export function stateLabel(state: AgaState) {
  switch (state) {
    case 'idle': return 'Starting';
    case 'armed': return 'Listening for Hey AGA';
    case 'wake_confirmed': return 'AGA is awake';
    case 'listening': return 'Listening';
    case 'thinking': return 'Thinking';
    case 'speaking': return 'Speaking';
    case 'playing_media': return 'Playing media';
    case 'translating': return 'Translating';
    case 'agent_running': return 'Agent running';
    case 'recovering': return 'Recovering';
    case 'offline': return 'Offline';
  }
}

export function isActiveState(state: AgaState) {
  return state !== 'idle' && state !== 'armed' && state !== 'offline';
}
