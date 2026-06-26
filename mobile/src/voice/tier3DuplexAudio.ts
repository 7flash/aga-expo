import { measureMark } from '../observability/measure';
import { enterVoiceCommunicationMode, exitVoiceCommunicationMode, getNativeAudioCapabilities, startWakeForegroundService, stopWakeForegroundService, type AgaAudioModeStatus } from './nativeAudioSession';

let activeDepth = 0;
let lastStatus: AgaAudioModeStatus | null = null;

function env(name: string) {
  return process.env?.[name] ?? '';
}

function envFlag(name: string, fallback: boolean) {
  const raw = env(name).trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export async function enterTier3DuplexAudio(reason = 'live_session') {
  activeDepth += 1;
  if (activeDepth > 1) return lastStatus || { ok: true, mode: 'already-active' };
  lastStatus = await enterVoiceCommunicationMode({ reason, speaker: envFlag('EXPO_PUBLIC_AGA_LIVE_SPEAKERPHONE', true) });
  measureMark('voice.aec.enter', { reason, status: lastStatus });
  return lastStatus;
}

export async function exitTier3DuplexAudio(reason = 'live_session_stop') {
  activeDepth = Math.max(0, activeDepth - 1);
  if (activeDepth > 0) return lastStatus || { ok: true, mode: 'still-active' };
  const status = await exitVoiceCommunicationMode();
  lastStatus = null;
  measureMark('voice.aec.exit', { reason, status });
  return status;
}

export async function ensureWakeForegroundService(reason = 'wake_keyword') {
  if (!envFlag('EXPO_PUBLIC_AGA_WAKE_FOREGROUND_SERVICE', true)) return { ok: true, foreground: false, message: 'disabled by env' };
  const status = await startWakeForegroundService({ title: 'AGA is listening', text: `Wake engine active: ${reason}` });
  measureMark('voice.foreground_wake.start', status);
  return status;
}

export async function releaseWakeForegroundService(reason = 'stop') {
  const status = await stopWakeForegroundService();
  measureMark('voice.foreground_wake.stop', { reason, status });
  return status;
}

export function tier3AudioDiagnostics() {
  return {
    activeDepth,
    lastStatus,
    native: getNativeAudioCapabilities(),
    foregroundWakeEnabled: envFlag('EXPO_PUBLIC_AGA_WAKE_FOREGROUND_SERVICE', true),
  };
}
