import { AGA_CONFIG, summarizeAgaConfig, type AgaDisplayMode, type AgaLiveSessionPolicy, type AgaShortTtsProvider, type AgaWakeEngineKind } from '../config/agaConfig';

export type WakeEngineKind = AgaWakeEngineKind;
export type ShortTtsProvider = AgaShortTtsProvider;
export type LiveEscalationMode = AgaLiveSessionPolicy;
export type DisplayMode = AgaDisplayMode;

export const AGA_ARCHITECTURE_FLAGS = Object.freeze({
  wakeEngine: AGA_CONFIG.wake.engine,
  shortTtsProvider: AGA_CONFIG.tts.provider,
  liveEscalation: AGA_CONFIG.brain.liveSessionPolicy,
  displayMode: AGA_CONFIG.display.mode,
  allowDirectKeys: AGA_CONFIG.security.allowDirectKeys,
  deterministicGuidedSessions: AGA_CONFIG.appliance.deterministicGuidedSessions,
  emergencySystemTts: AGA_CONFIG.appliance.emergencySystemTts,
  pureDisplay: AGA_CONFIG.display.pureDisplay,
});

export function describeArchitectureFlags() {
  return summarizeAgaConfig();
}
