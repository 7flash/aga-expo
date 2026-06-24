import { StyleSheet } from 'react-native';

export const colors = {
  bg: '#080b1d',
  bgDeep: '#050817',
  text: '#f8fbff',
  warmText: '#fff7ed',
  muted: '#cbd5e1',
  cyan: '#67e8f9',
  gold: '#fef3c7',
  pink: '#f9a8d4',
  lavender: '#a78bfa',
  danger: '#fb7185',
  success: '#bbf7d0',
  darkInk: '#06111c',
} as const;

export const panels = {
  glass: 'rgba(255,255,255,0.07)',
  glassSoft: 'rgba(255,255,255,0.055)',
  input: 'rgba(15,23,42,0.75)',
  border: 'rgba(255,255,255,0.14)',
  borderStrong: 'rgba(255,255,255,0.16)',
  cyanSoft: 'rgba(103,232,249,0.16)',
  dangerSoft: 'rgba(251,113,133,0.14)',
  goldSoft: 'rgba(254,243,199,0.1)',
} as const;

export const layers = {
  avatar: 0,
  media: 10,
  panel: 20,
  diagnostics: 30,
  setup: 40,
  modal: 50,
} as const;

export const hairline = StyleSheet.hairlineWidth;
