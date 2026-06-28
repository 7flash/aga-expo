import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { AgaErrorBoundary } from '../ui/AgaErrorBoundary';
import { AgaPureDisplayScreen } from '../ui/AgaPureDisplayScreen';
import { AgaZenScreen } from '../ui/AgaZenScreen';
import { startDefaultBrowserVoiceAppliance } from '../voice/browserAppliance/browserVoiceAppliance';

function displayMode() {
  return String(process.env?.EXPO_PUBLIC_AGA_DISPLAY_MODE ?? '').trim().toLowerCase();
}

function browserVoiceEnabled() {
  return String(process.env?.EXPO_PUBLIC_AGA_BROWSER_APPLIANCE ?? '1') !== '0';
}

/**
 * Route gate for production behind-glass builds.
 *
 * Browser now starts the composable voice appliance automatically:
 * volume threshold wake -> OpenAI STT -> GPT tool router -> ElevenLabs TTS,
 * with live-session delegation through the configured polymorphic agent layer.
 */
export default function AgaIndexRoute() {
  useEffect(() => {
    if (Platform.OS !== 'web' || !browserVoiceEnabled()) return;
    let cancelled = false;
    void startDefaultBrowserVoiceAppliance().catch((error) => {
      if (!cancelled) console.warn('[aga:browser-appliance] start failed', error);
    });
    return () => { cancelled = true; };
  }, []);

  const mode = displayMode();
  const pure = mode === 'tactile_AGA' || mode === 'pure_display' || mode === 'behind_glass' || mode === 'true_hologram';
  return (
    <AgaErrorBoundary>
      {pure ? <AgaPureDisplayScreen /> : <AgaZenScreen />}
    </AgaErrorBoundary>
  );
}
