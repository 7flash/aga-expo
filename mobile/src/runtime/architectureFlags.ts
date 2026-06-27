export type WakeEngineKind = 'porcupine' | 'android_speech_fallback' | 'disabled';
export type ShortTtsProvider = 'elevenlabs' | 'openai' | 'system' | 'silent';
export type LiveEscalationMode = 'never' | 'manual' | 'auto' | 'always';
export type DisplayMode = 'tactile_AGA' | 'hologram' | 'zen' | 'debug';

function env(name: string, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

function flag(name: string, fallback = false) {
  const raw = env(name, fallback ? '1' : '0').toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

export const AGA_ARCHITECTURE_FLAGS = Object.freeze({
  wakeEngine: oneOf<WakeEngineKind>(env('EXPO_PUBLIC_AGA_WAKE_ENGINE', 'porcupine'), ['porcupine', 'android_speech_fallback', 'disabled'], 'porcupine'),
  shortTtsProvider: oneOf<ShortTtsProvider>(env('EXPO_PUBLIC_AGA_SHORT_TTS_PROVIDER', 'elevenlabs'), ['elevenlabs', 'openai', 'system', 'silent'], 'elevenlabs'),
  liveEscalation: oneOf<LiveEscalationMode>(env('EXPO_PUBLIC_AGA_LIVE_ESCALATION', 'auto'), ['never', 'manual', 'auto', 'always'], 'auto'),
  displayMode: oneOf<DisplayMode>(env('EXPO_PUBLIC_AGA_DISPLAY_MODE', 'tactile_AGA'), ['tactile_AGA', 'hologram', 'zen', 'debug'], 'tactile_AGA'),
  allowDirectKeys: flag('EXPO_PUBLIC_AGA_ALLOW_DIRECT_KEYS', true),
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
