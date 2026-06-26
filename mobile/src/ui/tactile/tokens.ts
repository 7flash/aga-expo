export const tactile = {
  colors: {
    void: '#000000',
    panel: '#071014',
    panelRaised: '#111b1f',
    panelDark: '#030607',
    gunmetal: '#172025',
    graphite: '#20272b',
    copper: '#8a5a34',
    copperDark: '#3b2415',
    amber: '#f4b547',
    cyan: '#48f0ff',
    cyanDeep: '#0b5864',
    magenta: '#c45bff',
    crimson: '#ff4b61',
    text: '#e8fbff',
    etched: '#8eb7bd',
    shadow: '#000000',
  },
  material: {
    bevel: 3,
    deepBevel: 6,
    specularOpacity: 0.42,
    grainOpacity: 0.08,
    neuralOpacity: 0.62,
    panelRadius: 18,
    controlRadius: 14,
  },
  spring: {
    press: { damping: 11, stiffness: 250, mass: 0.8 },
    switchThrow: { damping: 13, stiffness: 190, mass: 0.9 },
    neuralFire: { damping: 16, stiffness: 150, mass: 0.65 },
  },
} as const;

export type TactileMode = 'idle' | 'listening' | 'thinking' | 'speaking' | 'guided' | 'warning' | 'media';

export function glowForMode(mode: TactileMode | string) {
  switch (mode) {
    case 'speaking': return tactile.colors.amber;
    case 'guided': return tactile.colors.magenta;
    case 'warning': return tactile.colors.crimson;
    case 'media': return '#7df9b8';
    case 'thinking': return '#a488ff';
    case 'listening': return tactile.colors.cyan;
    default: return '#7fcbd4';
  }
}
