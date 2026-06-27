export type WakeEngineKind = 'sherpa' | 'sherpa_wasm' | 'sherpa_native' | 'porcupine' | 'dev' | 'disabled';
export type ShortTtsProvider = 'elevenlabs' | 'openai' | 'system' | 'silent';
export type LiveEscalationMode = 'never' | 'explicit_only' | 'casual_by_default' | 'most_requests' | 'always';
export type DisplayMode = 'true_hologram' | 'tactile_relic' | 'tactile_aga' | 'hologram' | 'zen' | 'debug';

function env(name: string, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

function flag(name: string, fallback = false) {
  const raw = env(name, fallback ? '1' : '0').toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  const clean = String(value || '').trim().toLowerCase().replace(/-/g, '_') as T;
  return (allowed as readonly string[]).includes(clean) ? clean : fallback;
}

function wakeEngine(): WakeEngineKind {
  const value = env('EXPO_PUBLIC_AGA_KEYWORD_ENGINE', env('EXPO_PUBLIC_AGA_WAKE_ENGINE', 'sherpa'));
  return oneOf<WakeEngineKind>(value, ['sherpa', 'sherpa_wasm', 'sherpa_native', 'porcupine', 'dev', 'disabled'], 'sherpa');
}

export const AGA_ARCHITECTURE_FLAGS = Object.freeze({
  wakeEngine: wakeEngine(),
  shortTtsProvider: oneOf<ShortTtsProvider>(env('EXPO_PUBLIC_AGA_SHORT_TTS_PROVIDER', env('EXPO_PUBLIC_AGA_TTS_PROVIDER', 'elevenlabs')), ['elevenlabs', 'openai', 'system', 'silent'], 'elevenlabs'),
  liveEscalation: oneOf<LiveEscalationMode>(env('EXPO_PUBLIC_AGA_LIVE_SESSION_POLICY', 'casual_by_default'), ['never', 'explicit_only', 'casual_by_default', 'most_requests', 'always'], 'casual_by_default'),
  displayMode: oneOf<DisplayMode>(env('EXPO_PUBLIC_AGA_DISPLAY_MODE', 'true_hologram'), ['true_hologram', 'tactile_relic', 'tactile_aga', 'hologram', 'zen', 'debug'], 'true_hologram'),
  allowDirectKeys: flag('EXPO_PUBLIC_AGA_ALLOW_DIRECT_KEYS', false),
  deterministicGuidedSessions: flag('EXPO_PUBLIC_AGA_DETERMINISTIC_GUIDED', true),
  emergencySystemTts: flag('EXPO_PUBLIC_AGA_EMERGENCY_SYSTEM_TTS', true),
  pureDisplay: flag('EXPO_PUBLIC_AGA_PURE_DISPLAY', true),
});

export function describeArchitectureFlags() {
  const f = AGA_ARCHITECTURE_FLAGS;
  return [
    `wake=${f.wakeEngine}`,
    `shortTts=${f.shortTtsProvider}`,
    `live=${f.liveEscalation}`,
    `display=${f.displayMode}`,
    `directKeys=${f.allowDirectKeys ? 'allowed' : 'blocked'}`,
    `guided=${f.deterministicGuidedSessions ? 'deterministic' : 'model-paced'}`,
  ].join(' ');
}
