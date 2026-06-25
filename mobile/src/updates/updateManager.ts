import type { RemoteConfig } from '../remote/config';
import { emitObservation } from '../remote/observability';

let busy = false;

function loadUpdates(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-updates');
  } catch {
    return null;
  }
}

export async function maybeApplyOtaUpdate(config?: RemoteConfig | null) {
  const policy = config?.updates?.ota ?? process.env.EXPO_PUBLIC_AGA_OTA_POLICY ?? 'check';
  if (policy === 'off' || busy) return { checked: false, reason: 'off_or_busy' };
  const Updates = loadUpdates();
  if (!Updates?.checkForUpdateAsync) return { checked: false, reason: 'expo-updates-unavailable' };
  busy = true;
  try {
    const result = await Updates.checkForUpdateAsync();
    emitObservation('updates', 'check', { available: !!result?.isAvailable, policy, revision: config?.revision });
    if (!result?.isAvailable || policy === 'check') return { checked: true, available: !!result?.isAvailable };
    if (!Updates.fetchUpdateAsync) return { checked: true, available: true, fetched: false };
    const fetched = await Updates.fetchUpdateAsync();
    emitObservation('updates', 'fetch', { fetched: true, manifest: !!fetched?.manifest });
    if (policy === 'fetch_and_reload' && Updates.reloadAsync) {
      await Updates.reloadAsync();
      return { checked: true, available: true, fetched: true, reloaded: true };
    }
    return { checked: true, available: true, fetched: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'update failed');
    emitObservation('updates', 'error', { message });
    return { checked: false, error: message };
  } finally {
    busy = false;
  }
}

export function nativeUpdateMessage(config?: RemoteConfig | null) {
  if (!config?.updates?.nativeUpdateRequired && !config?.updates?.apkUrl) return null;
  return config.updates.message || `A native APK update is available${config.updates.apkVersion ? `: ${config.updates.apkVersion}` : ''}.`;
}
