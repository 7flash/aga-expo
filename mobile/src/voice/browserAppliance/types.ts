import type { ShortUtteranceAudio } from '../shortUtteranceRecorder';

export type BrowserApplianceMode =
  | 'idle'
  | 'wake-listening'
  | 'awake'
  | 'capturing'
  | 'transcribing'
  | 'routing'
  | 'speaking'
  | 'live-session'
  | 'error';

export type BrowserApplianceEvent =
  | { type: 'status'; mode?: BrowserApplianceMode; message: string; raw?: unknown }
  | { type: 'wake'; provider: string; rms?: number; confidence?: number; raw?: unknown }
  | { type: 'audio-level'; rms: number; peak: number }
  | { type: 'utterance'; provider: string; audio: ShortUtteranceAudio; durationMs: number; raw?: unknown }
  | { type: 'transcript'; text: string; raw?: unknown }
  | { type: 'assistant'; text: string; raw?: unknown }
  | { type: 'tool'; name: string; args?: Record<string, unknown>; result?: string }
  | { type: 'route'; route: 'local-control' | 'short-tools' | 'live-agent' | 'deterministic-session'; reason: string }
  | { type: 'error'; message: string; raw?: unknown };

export type BrowserApplianceListener = (event: BrowserApplianceEvent) => void;

export type BrowserWakeLayer = {
  readonly name: string;
  start(listener: BrowserApplianceListener): Promise<void>;
  stop(): Promise<void> | void;
  mute?(ms: number): void;
  getDiagnostics?(): unknown;
};

export type BrowserSttLayer = {
  readonly name: string;
  transcribe(audio: ShortUtteranceAudio): Promise<string>;
};

export type BrowserTtsLayer = {
  readonly name: string;
  speak(text: string, options?: { emotion?: string; signal?: AbortSignal }): Promise<void>;
  stop(): Promise<void> | void;
};

export type BrowserLiveAgentLayer = {
  readonly name: string;
  startWithText(text: string): Promise<void>;
  stop(): Promise<void> | void;
  isActive(): boolean;
};

export type BrowserCommandResult = {
  route: 'local-control' | 'short-tools' | 'live-agent' | 'deterministic-session';
  text?: string;
  shouldSpeak?: boolean;
  handled?: boolean;
};
