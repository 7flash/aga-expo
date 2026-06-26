import { Platform } from 'react-native';
import { getNativeAudioCapabilities } from './nativeAudioSession';
import { tier3AudioDiagnostics } from './tier3DuplexAudio';
import { resolveSherpaManifest, sherpaManifestSummary, validateSherpaManifest } from './sherpaModelManifest';

function env(name: string) {
  return process.env?.[name] ?? '';
}

function envFlag(name: string, fallback: boolean) {
  const raw = env(name).trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export function applianceRuntimeSafetyReport() {
  const native = getNativeAudioCapabilities();
  const sherpaWake = resolveSherpaManifest('wake');
  const sherpaMenu = resolveSherpaManifest('menu');
  const sherpaWakeValidation = validateSherpaManifest(sherpaWake);
  const sherpaMenuValidation = validateSherpaManifest(sherpaMenu);
  const requireNativeAec = envFlag('EXPO_PUBLIC_AGA_REQUIRE_NATIVE_AEC', Platform.OS !== 'web');
  const requireForeground = envFlag('EXPO_PUBLIC_AGA_WAKE_FOREGROUND_SERVICE', Platform.OS === 'android');
  const problems: string[] = [];

  if (Platform.OS !== 'web' && requireNativeAec && !native.nativeAvailable) problems.push('native AEC module unavailable');
  if (Platform.OS === 'android' && native.nativeAvailable && native.recordAudioGranted === false) problems.push('RECORD_AUDIO permission missing');
  if (Platform.OS === 'android' && native.nativeAvailable && native.postNotificationsGranted === false) problems.push('POST_NOTIFICATIONS permission missing; wake foreground notification may be hidden');
  if (Platform.OS === 'android' && requireForeground && !envFlag('EXPO_PUBLIC_AGA_WAKE_FOREGROUND_SERVICE', true)) problems.push('foreground wake service disabled');

  return {
    ok: problems.length === 0,
    platform: Platform.OS,
    requireNativeAec,
    requireForeground,
    nativeAudio: native,
    tier3: tier3AudioDiagnostics(),
    sherpa: { wake: sherpaManifestSummary(sherpaWake), menu: sherpaManifestSummary(sherpaMenu), wakeValidation: sherpaWakeValidation, menuValidation: sherpaMenuValidation },
    problems,
  };
}
