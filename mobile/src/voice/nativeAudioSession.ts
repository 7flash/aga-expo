import { AppState, Platform, NativeModules } from 'react-native';

export type AgaAudioModeStatus = {
  ok: boolean;
  platform?: string;
  mode?: string;
  foreground?: boolean;
  message?: string;
  nativeAvailable?: boolean;
  aecAvailable?: boolean;
  noiseSuppressorAvailable?: boolean;
  autoGainControlAvailable?: boolean;
  recordAudioGranted?: boolean;
  postNotificationsGranted?: boolean;
  currentRoute?: string;
  [key: string]: unknown;
};

async function optionalExpoAudio() {
  try {
    return await (Function('s', 'return import(s)') as any)('expo-av');
  } catch {
    return null;
  }
}

function nativeModule(): any | null {
  try {
    const modules = NativeModules as any;
    return modules?.AgaNativeAudio || modules?.ExpoModules?.AgaNativeAudio || null;
  } catch {
    return null;
  }
}

async function callNative(name: string, args?: unknown): Promise<AgaAudioModeStatus | null> {
  const mod = nativeModule();
  const fn = mod?.[name];
  if (typeof fn !== 'function') return null;
  const value = args === undefined ? await fn() : await fn(args);
  return { ok: true, nativeAvailable: true, ...(value || {}) };
}

function isVoiceMode(status: AgaAudioModeStatus | null | undefined) {
  const mode = String(status?.mode || status?.audioModeName || '').toLowerCase();
  return mode.includes('voicechat') || mode.includes('voice_chat') || mode.includes('communication') || mode.includes('browser-echo');
}

export async function enterVoiceCommunicationMode(options: { speaker?: boolean; reason?: string } = {}): Promise<AgaAudioModeStatus> {
  const native = await callNative('enterVoiceChatMode', options);
  if (native) return native;

  // Browser and managed/dev fallback. This does not guarantee hardware AEC, but
  // it makes browser previews use WebRTC echo-cancellation constraints.
  if (Platform.OS === 'web') {
    return { ok: true, platform: 'web', mode: 'browser-echo-cancellation-constraints', nativeAvailable: false };
  }

  const av = await optionalExpoAudio();
  try {
    await av?.Audio?.setAudioModeAsync?.({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
    return { ok: true, platform: Platform.OS, mode: 'expo-audio-duplex-fallback', nativeAvailable: false };
  } catch (error) {
    return { ok: false, platform: Platform.OS, mode: 'duplex-fallback-failed', nativeAvailable: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export async function exitVoiceCommunicationMode(): Promise<AgaAudioModeStatus> {
  const native = await callNative('exitVoiceChatMode');
  if (native) return native;
  const av = await optionalExpoAudio();
  try {
    await av?.Audio?.setAudioModeAsync?.({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });
  } catch { /* ignore */ }
  return { ok: true, platform: Platform.OS, mode: 'normal-fallback', nativeAvailable: false };
}

export async function startWakeForegroundService(options: { title?: string; text?: string } = {}): Promise<AgaAudioModeStatus> {
  const native = await callNative('startWakeForegroundService', options);
  if (native) return native;
  return { ok: Platform.OS !== 'android', platform: Platform.OS, foreground: false, nativeAvailable: false, message: Platform.OS === 'android' ? 'AgaNativeAudio foreground service unavailable; prebuild/rebuild native module.' : 'No foreground service required on this platform.' };
}

export async function refreshWakeForegroundService(options: { title?: string; text?: string } = {}): Promise<AgaAudioModeStatus> {
  const native = await callNative('refreshWakeForegroundService', options);
  if (native) return native;
  if (Platform.OS === 'android') return startWakeForegroundService(options);
  return { ok: true, platform: Platform.OS, foreground: false, nativeAvailable: false };
}

export async function stopWakeForegroundService(): Promise<AgaAudioModeStatus> {
  const native = await callNative('stopWakeForegroundService');
  if (native) return native;
  return { ok: true, platform: Platform.OS, foreground: false, nativeAvailable: false };
}

export function getNativeAudioCapabilities(): AgaAudioModeStatus {
  const mod = nativeModule();
  if (typeof mod?.getCapabilities === 'function') {
    try { return { ok: true, nativeAvailable: true, ...mod.getCapabilities() }; } catch { /* ignore */ }
  }
  return { ok: false, platform: Platform.OS, nativeAvailable: false, message: 'AgaNativeAudio native module unavailable.' };
}

export function assertTier3EchoSafety(status: AgaAudioModeStatus, options: { requireNative?: boolean } = {}) {
  const requireNative = options.requireNative ?? (Platform.OS !== 'web' && process.env?.EXPO_PUBLIC_AGA_REQUIRE_NATIVE_AEC === '1');
  if (!status.ok) throw new Error(status.message || 'Voice communication audio mode failed.');
  if (requireNative && !status.nativeAvailable) throw new Error('Native AEC/audio session module is required for Tier 3 live duplex mode. Rebuild the APK/IPA with modules/aga-native-audio.');
  if (Platform.OS !== 'web' && !isVoiceMode(status)) throw new Error(`Unsafe live audio mode: ${status.mode || 'unknown'}. Tier 3 requires VoiceChat/MODE_IN_COMMUNICATION.`);
  return true;
}

export function appIsForeground() {
  return AppState.currentState === 'active';
}
