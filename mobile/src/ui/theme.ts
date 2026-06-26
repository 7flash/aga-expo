export const colors = {
  bg: '#080b1f',
  bg2: '#12163a',
  panel: 'rgba(255, 255, 255, 0.09)',
  panelStrong: 'rgba(255, 255, 255, 0.16)',
  border: 'rgba(255, 255, 255, 0.16)',
  text: '#fbfcff',
  muted: 'rgba(231, 238, 255, 0.72)',
  faint: 'rgba(231, 238, 255, 0.48)',
  cyan: '#67e8f9',
  gold: '#fef3c7',
  pink: '#f9a8d4',
  lavender: '#a78bfa',
  violet: '#7c3aed',
  danger: '#fb7185',
  good: '#86efac',
};

/**
 * Tactile Neural Relic material system.
 *
 * These tokens intentionally avoid soft translucent card language. They
 * describe physical, mechanical, slightly worn controls projected behind glass:
 * beveled panels, embossed labels, oxidized edges, patina, neural glow, and
 * tactile spring behavior for voice-triggered actuation.
 */
export const tactileRelicTheme = {
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
  },
  material: {
    panelRadius: 22,
    controlRadius: 16,
    bevelStrength: 3,
    deepBevelStrength: 7,
    specularIntensity: 0.46,
    grainOpacity: 0.11,
    patinaOpacity: 0.18,
    neuralOpacity: 0.68,
    scanlineOpacity: 0.045,
    chromaticEdgeOffsetPx: 1.25,
  },
  motion: {
    pressTravelPx: 7,
    springDamping: 10,
    springStiffness: 280,
    switchThrowDegrees: 31,
    neuralFireMs: 620,
  },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
  pill: 999,
};

export const z = {
  base: 0,
  avatar: 1,
  panel: 10,
  debug: 20,
  modal: 30,
};
