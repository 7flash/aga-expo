import React from 'react';
import type { AgaMode } from '../aga/turn';
import { AgaAvatarZen } from '../ui/AgaAvatarZen';
import { TactileRelicAngel } from './TactileRelicAngel';

type Props = {
  mode: AgaMode;
  audioLevel?: number;
  compact?: boolean;
  size?: number;
  wear?: number;
  interactionPulse?: number;
};

function env(name: string) {
  return String(process.env?.[name] ?? '').trim().toLowerCase();
}

function envFlag(name: string, fallback = false) {
  const raw = env(name);
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * Single avatar surface selector.
 *
 * `tactile_relic` is the behind-glass production aesthetic: GPU-driven,
 * physical/mechanical, worn, neuromorphic, and display-only. The older SVG Zen
 * avatar and the earlier hologram shader remain compatibility fallbacks.
 */
export function AngelVisual(props: Props) {
  const displayMode = env('EXPO_PUBLIC_AGA_DISPLAY_MODE');
  const engine = env('EXPO_PUBLIC_AGA_VISUAL_ENGINE');
  const forceSvg = envFlag('EXPO_PUBLIC_AGA_FORCE_SVG_AVATAR', false);
  const mirror = envFlag('EXPO_PUBLIC_AGA_HOLOGRAM_MIRROR', false);
  const lowPower = envFlag('EXPO_PUBLIC_AGA_LOW_POWER_VISUALS', false);

  if (!forceSvg && (displayMode === 'tactile_relic' || engine === 'tactile_relic' || engine === 'relic_gl')) {
    return <TactileRelicAngel {...props} mirror={mirror} lowPower={lowPower} />;
  }


  return <AgaAvatarZen {...props} />;
}
