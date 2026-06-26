import React from 'react';
import type { AgaMode } from '../aga/turn';
import { AgaAvatarZen } from '../ui/AgaAvatarZen';
import { HologramAngel } from './HologramAngel';

type Props = {
  mode: AgaMode;
  audioLevel?: number;
  compact?: boolean;
  size?: number;
};

function displayMode() {
  return String(process.env?.EXPO_PUBLIC_AGA_DISPLAY_MODE ?? '').trim().toLowerCase();
}

function envFlag(name: string, fallback = false) {
  const raw = String(process.env?.[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * Single avatar surface.
 *
 * Hologram builds get a black, emissive GL surface for behind-glass/Pepper's
 * ghost setups. The SVG Zen avatar remains the fallback for web harnesses,
 * devices without expo-gl, and debug builds.
 */
export function AngelVisual(props: Props) {
  if (displayMode() === 'hologram' && !envFlag('EXPO_PUBLIC_AGA_FORCE_SVG_AVATAR', false)) {
    return <HologramAngel {...props} mirror={envFlag('EXPO_PUBLIC_AGA_HOLOGRAM_MIRROR', false)} lowPower={envFlag('EXPO_PUBLIC_AGA_LOW_POWER_VISUALS', false)} />;
  }
  return <AgaAvatarZen {...props} />;
}
