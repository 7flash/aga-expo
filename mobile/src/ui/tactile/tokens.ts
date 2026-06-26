export const tactileRelic = {
  colors: {
    void: '#000000',
    deckBlack: '#020404',
    panelBase: '#071011',
    panelRaised: '#111b1c',
    panelInset: '#050808',
    gunmetal: '#182224',
    gunmetalHi: '#2d383a',
    graphite: '#20282a',
    oxidizedCopper: '#8d5731',
    copperDark: '#2d1b10',
    biopolymer: '#172321',
    wornEdge: '#738185',
    neuralCyan: '#48f0ff',
    neuralTeal: '#23d7c4',
    neuralMagenta: '#b45cff',
    amber: '#f0ae3f',
    oldLed: '#d99a2e',
    crimson: '#ff4b61',
    coolWhite: '#e8fbff',
    engraved: '#87aeb0',
    shadow: '#000000',
  },
  material: {
    panelRadius: 22,
    controlRadius: 16,
    bevel: 3,
    deepBevel: 7,
    specularOpacity: 0.46,
    grainOpacity: 0.11,
    patinaOpacity: 0.18,
    neuralOpacity: 0.68,
    scanlineOpacity: 0.045,
    chromaOffset: 1.25,
  },
  spring: {
    press: { damping: 10, stiffness: 280, mass: 0.85 },
    switchThrow: { damping: 12, stiffness: 210, mass: 0.9 },
    detent: { damping: 14, stiffness: 175, mass: 0.95 },
    neuralFire: { damping: 16, stiffness: 165, mass: 0.7 },
  },
} as const;

// Backwards-compatible alias for earlier tactile pass imports.
export const tactile = tactileRelic;

export type TactileMode =
  | 'sleeping'
  | 'idle'
  | 'listening'
  | 'awake'
  | 'thinking'
  | 'speaking'
  | 'guided'
  | 'media'
  | 'warning'
  | 'recovering'
  | 'offline'
  | 'settings'
  | 'translating';

export function glowForMode(mode: TactileMode | string) {
  switch (mode) {
    case 'speaking': return tactileRelic.colors.amber;
    case 'guided': return tactileRelic.colors.neuralMagenta;
    case 'warning':
    case 'recovering':
    case 'offline': return tactileRelic.colors.crimson;
    case 'media': return '#78f0b0';
    case 'thinking': return '#9d86ff';
    case 'settings': return tactileRelic.colors.oldLed;
    case 'awake':
    case 'listening': return tactileRelic.colors.neuralCyan;
    case 'translating': return '#7bdcff';
    default: return '#73c9cf';
  }
}

export function materialForWear(wear = 0) {
  const w = Math.max(0, Math.min(1, Number(wear) || 0));
  return {
    patinaOpacity: tactileRelic.material.patinaOpacity + w * 0.18,
    neuralBoost: 1 + w * 0.65,
    edgeGlow: 0.16 + w * 0.28,
    grainOpacity: tactileRelic.material.grainOpacity + w * 0.07,
  };
}
