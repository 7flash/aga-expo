import React from 'react';
import type { AgaMode } from '../aga/turn';
import { AgaAvatarZen } from '../ui/AgaAvatarZen';
import { TactileHologramAngel } from './TactileHologramAngel';

type Props = {
  mode: AgaMode;
  audioLevel?: number;
  compact?: boolean;
  size?: number;
  wear?: number;
};

function displayMode() {
  return String(process.env?.EXPO_PUBLIC_AGA_DISPLAY_MODE ?? '').trim().toLowerCase();
}

function visualEngine() {
  return String(process.env?.EXPO_PUBLIC_AGA_VISUAL_ENGINE ?? '').trim().toLowerCase();
}

function envFlag(name: string, fallback = false) {
  const raw = String(process.env?.[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * Single avatar surface.
 *
 * Tactile hologram builds use a GPU shader that keeps breathing/halo/neural
 * motion off the JS thread. The SVG Zen avatar remains the compatibility
 * fallback for web harnesses, old APKs, or builds without expo-gl.
 */
export function AngelVisual(props: Props) {
  const mode = displayMode();
  const engine = visualEngine();
  const tactile = mode === 'tactile_hologram' || engine === 'tactile_gl' || engine === 'gl';
  if (tactile && !envFlag('EXPO_PUBLIC_AGA_FORCE_SVG_AVATAR', false)) {
    return (
      <TactileHologramAngel
        {...props}
        mirror={envFlag('EXPO_PUBLIC_AGA_HOLOGRAM_MIRROR', false)}
        lowPower={envFlag('EXPO_PUBLIC_AGA_LOW_POWER_VISUALS', false)}
      />
    );
  }
  return <AgaAvatarZen {...props} />;
}
