import { requireNativeModule } from 'expo-modules-core';

export type AgaNativeAudioStatus = {
  ok: boolean;
  platform?: string;
  mode?: string;
  foreground?: boolean;
  message?: string;
  aecAvailable?: boolean;
  noiseSuppressorAvailable?: boolean;
  autoGainControlAvailable?: boolean;
  recordAudioGranted?: boolean;
  postNotificationsGranted?: boolean;
  [key: string]: unknown;
};

type NativeAudioModule = {
  enterVoiceChatMode(options?: Record<string, unknown>): Promise<AgaNativeAudioStatus>;
  exitVoiceChatMode(): Promise<AgaNativeAudioStatus>;
  startWakeForegroundService(options?: Record<string, unknown>): Promise<AgaNativeAudioStatus>;
  refreshWakeForegroundService(options?: Record<string, unknown>): Promise<AgaNativeAudioStatus>;
  stopWakeForegroundService(): Promise<AgaNativeAudioStatus>;
  getCapabilities(): AgaNativeAudioStatus & Record<string, unknown>;
};

export const AgaNativeAudio = requireNativeModule<NativeAudioModule>('AgaNativeAudio');
