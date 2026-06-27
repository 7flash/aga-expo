import React from 'react';
import { AgaErrorBoundary } from '../ui/AgaErrorBoundary';
import { AgaPureDisplayScreen } from '../ui/AgaPureDisplayScreen';
import { AgaZenScreen } from '../ui/AgaZenScreen';

function displayMode() {
  return String(process.env?.EXPO_PUBLIC_AGA_DISPLAY_MODE ?? '').trim().toLowerCase();
}

/**
 * Route gate for production behind-glass builds.
 *
 * `tactile_AGA` strips the app down to the display-only neuromorphic control
 * deck. No router chrome or touch UI is mounted on the main screen.
 */
export default function AgaIndexRoute() {
  const mode = displayMode();
  const pure = mode === 'tactile_AGA' || mode === 'pure_display' || mode === 'behind_glass';
  return (
    <AgaErrorBoundary>
      {pure ? <AgaPureDisplayScreen /> : <AgaZenScreen />}
    </AgaErrorBoundary>
  );
}
