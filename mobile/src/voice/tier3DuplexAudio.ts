import { AppState, Platform } from 'react-native';
import { measureMark } from '../observability/measure';
import {
  assertTier3EchoSafety,
  enterVoiceCommunicationMode,
  exitVoiceCommunicationMode,
  getNativeAudioCapabilities,
  refreshWakeForegroundService,
  startWakeForegroundService,
  stopWakeForegroundService,
  type AgaAudioModeStatus,
} from './nativeAudioSession';

let activeDepth = 0;
let lastStatus: AgaAudioModeStatus | null = null;
let foregroundWakeActive = false;
let foregroundHeartbeat: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove?: () => void } | null = null;
let lastForegroundText = 'Wake engine active';

function env(name: string) {
  return process.env?.[name] ?? '';
}

function envFlag(name: string, fallback: boolean) {
  const raw = env(name).trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function numberEnv(name: string, fallback: number) {
  const value = Number(env(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export async function enterTier3DuplexAudio(reason = 'live_session') {
  activeDepth += 1;
  if (activeDepth > 1) return lastStatus || { ok: true, mode: 'already-active' };
  lastStatus = await enterVoiceCommunicationMode({ reason, speaker: envFlag('EXPO_PUBLIC_AGA_LIVE_SPEAKERPHONE', true) });
  assertTier3EchoSafety(lastStatus, { requireNative: envFlag('EXPO_PUBLIC_AGA_REQUIRE_NATIVE_AEC', Platform.OS !== 'web') });
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
  lastForegroundText = `Wake engine active: ${reason}`;
  const status = await startWakeForegroundService({ title: 'AGA is listening', text: lastForegroundText });
  foregroundWakeActive = !!status.ok;
  ensureForegroundHeartbeat();
  measureMark('voice.foreground_wake.start', status);
  return status;
}

export async function refreshWakeForeground(reason = 'wake_keyword') {
  if (!foregroundWakeActive) return { ok: true, foreground: false, message: 'not active' };
  lastForegroundText = `Wake engine active: ${reason}`;
  const status = await refreshWakeForegroundService({ title: 'AGA is listening', text: lastForegroundText });
  measureMark('voice.foreground_wake.refresh', status);
  return status;
}

export async function releaseWakeForegroundService(reason = 'stop') {
  foregroundWakeActive = false;
  if (foregroundHeartbeat) clearInterval(foregroundHeartbeat);
  foregroundHeartbeat = null;
  appStateSub?.remove?.();
  appStateSub = null;
  const status = await stopWakeForegroundService();
  measureMark('voice.foreground_wake.stop', { reason, status });
  return status;
}

function ensureForegroundHeartbeat() {
  if (Platform.OS === 'web') return;
  if (!foregroundHeartbeat) {
    foregroundHeartbeat = setInterval(() => {
      if (!foregroundWakeActive) return;
      void refreshWakeForegroundService({ title: 'AGA is listening', text: lastForegroundText }).catch(() => undefined);
    }, numberEnv('EXPO_PUBLIC_AGA_WAKE_FOREGROUND_REFRESH_MS', 60_000));
  }
  if (!appStateSub) {
    appStateSub = AppState.addEventListener('change', (state) => {
      if (!foregroundWakeActive) return;
      void refreshWakeForegroundService({ title: 'AGA is listening', text: state === 'active' ? lastForegroundText : 'Wake engine active in background' }).catch(() => undefined);
    });
  }
}

export function tier3AudioDiagnostics() {
  return {
    activeDepth,
    lastStatus,
    native: getNativeAudioCapabilities(),
    foregroundWakeEnabled: envFlag('EXPO_PUBLIC_AGA_WAKE_FOREGROUND_SERVICE', true),
    foregroundWakeActive,
    requireNativeAec: envFlag('EXPO_PUBLIC_AGA_REQUIRE_NATIVE_AEC', Platform.OS !== 'web'),
  };
}
