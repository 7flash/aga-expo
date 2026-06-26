import type { AgaMode } from '../aga/turn';
import type { Reminder } from '../db/localStore';
import type { ChoiceMenu } from '../aga/choiceMenus';

export type VoiceTransportSnapshot = {
  ready: boolean;
  mode: AgaMode;
  interim: string;
  messages: Array<{ role: string; content: string; createdAt?: string }>;
  reminders: Reminder[];
  activeMedia: any;
  mediaCommand: 'pause' | 'resume' | 'stop' | 'volume_up' | 'volume_down' | 'mute' | 'unmute' | null;
  audioLevel: number;
  speechStatus: string;
  error: string | null;
  lastMeasure?: string;
  ttsStatus?: string;
  voiceSummary?: string;
  voiceCapability?: unknown;
  activeChoiceMenu?: ChoiceMenu | null;
  sessionLabel?: string | null;
  listeningMode?: string | null;
  remoteConfigRevision?: string | null;
  deviceLabel?: string | null;
  nativeUpdateMessage?: string | null;
};

export type VoiceTransportListener = (snapshot: VoiceTransportSnapshot) => void;

export interface VoiceTransport {
  readonly name: string;
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
  subscribe(listener: VoiceTransportListener): () => void;
  replay?(text: string): Promise<void> | void;
  closeMedia?(): Promise<void> | void;
  onMediaEvent?(event: string): void;
  rearmMic?(): Promise<void> | void;
  onTurnText?(text: string): Promise<void> | void;
}

export const EMPTY_VOICE_TRANSPORT_SNAPSHOT: VoiceTransportSnapshot = {
  ready: false,
  mode: 'sleeping',
  interim: '',
  messages: [],
  reminders: [],
  activeMedia: null,
  mediaCommand: null,
  audioLevel: 0,
  speechStatus: 'starting',
  error: null,
  activeChoiceMenu: null,
  sessionLabel: null,
};
