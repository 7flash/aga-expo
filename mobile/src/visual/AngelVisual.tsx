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
  return String(process.env?.[name] ?? '').trim().toLowerCase().replace(/-/g, '_');
}

function envFlag(name: string, fallback = false) {
  const raw = env(name);
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * Single avatar surface selector.
 *
 * true_hologram is the production behind-glass/Pepper's-ghost mode: black,
 * sparse, emissive angel only, no readable mirrored text or dense deck UI.
 * tactile_relic keeps the physical deck for flat-screen demos.
 */
export function AngelVisual(props: Props) {
  const displayMode = env('EXPO_PUBLIC_AGA_DISPLAY_MODE') || 'true_hologram';
  const engine = env('EXPO_PUBLIC_AGA_VISUAL_ENGINE');
  const forceSvg = envFlag('EXPO_PUBLIC_AGA_FORCE_SVG_AVATAR', false);
  const mirror = envFlag('EXPO_PUBLIC_AGA_HOLOGRAM_MIRROR', false);
  const lowPower = envFlag('EXPO_PUBLIC_AGA_LOW_POWER_VISUALS', false);
  const glMode = ['true_hologram', 'tactile_relic', 'tactile_aga', 'tactile_aga_gl', 'aga_gl'].includes(displayMode)
    || ['true_hologram', 'tactile_relic', 'tactile_aga', 'tactile_aga_gl', 'aga_gl'].includes(engine);

  if (!forceSvg && glMode) {
    return <TactileRelicAngel {...props} mirror={mirror} lowPower={lowPower} trueHologram={displayMode === 'true_hologram'} />;
  }

  return <AgaAvatarZen {...props} />;
}
