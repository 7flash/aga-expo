import { AGA_CONFIG, type AgaLiveEngine } from '../config/agaConfig';

export type AgaEngine = AgaLiveEngine;

type EngineDecision = {
  engine: AgaEngine;
  source: string;
  raw: string | null;
};

function env(name: string) {
  return String(process.env?.[name] ?? '').trim();
}

function envFlag(name: string, fallback = false) {
  const raw = env(name).toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function parseEngine(raw: string): AgaEngine | null {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return null;
  if (/elevenlabs_agent|eleven_agent|elevenlabs|xi[_-]?agent|convai|conversation[_-]?agent/.test(value)) return 'elevenlabs_agent';
  if (/gemini|google|bidi|generative/.test(value)) return 'gemini';
  if (/openai|realtime|gpt|oai/.test(value)) return 'openai';
  if (/local|offline|cognitive|none/.test(value)) return 'local';
  return null;
}

function decisionFrom(name: string): EngineDecision | null {
  const raw = env(name);
  const engine = parseEngine(raw);
  return engine ? { engine, source: name, raw } : null;
}

/**
 * Canonical live engine selector.
 *
 * AGA_CONFIG is the canonical parsed env surface. The legacy env fallbacks below
 * are kept only for older installs that have not migrated yet.
 */
export function getAgaEngineDecision(): EngineDecision {
  const configured = AGA_CONFIG.brain.liveEngine;
  if (configured) return { engine: configured, source: 'AGA_CONFIG.brain.liveEngine', raw: env('EXPO_PUBLIC_AGA_ENGINE') || configured };

  return decisionFrom('EXPO_PUBLIC_AGA_RUNTIME_ENGINE')
    ?? decisionFrom('EXPO_PUBLIC_AGA_BRAIN_PROVIDER')
    ?? decisionFrom('EXPO_PUBLIC_AGA_PROVIDER')
    ?? decisionFrom('EXPO_PUBLIC_AGA_VOICE_ENGINE')
    ?? (() => {
      const hasElevenLabsAgent = !!(env('EXPO_PUBLIC_ELEVENLABS_AGENT_ID') || env('EXPO_PUBLIC_ELEVENLABS_AGENT_SIGNED_URL_ENDPOINT') || env('EXPO_PUBLIC_AGA_ELEVENLABS_AGENT_SIGNED_URL_ENDPOINT'));
      const hasGemini = !!(env('EXPO_PUBLIC_GEMINI_API_KEY') || env('EXPO_PUBLIC_GOOGLE_API_KEY'));
      const hasOpenAI = !!(env('EXPO_PUBLIC_OPENAI_API_KEY') || env('EXPO_PUBLIC_AGA_REALTIME_TOKEN_URL') || env('EXPO_PUBLIC_AGA_REALTIME_SDP_URL'));
      if (hasElevenLabsAgent) return { engine: 'elevenlabs_agent', source: 'auto:elevenlabs_agent_configured', raw: null } as EngineDecision;
      if (hasGemini && !hasOpenAI) return { engine: 'gemini', source: 'auto:gemini_key_without_openai', raw: null } as EngineDecision;
      if (envFlag('EXPO_PUBLIC_AGA_PREFER_GEMINI', false) && hasGemini) return { engine: 'gemini', source: 'EXPO_PUBLIC_AGA_PREFER_GEMINI', raw: '1' } as EngineDecision;
      return { engine: 'openai', source: 'auto:default_openai', raw: null } as EngineDecision;
    })();
}

export function getAgaEngine(): AgaEngine {
  return getAgaEngineDecision().engine;
}

export function isGeminiEngine() {
  return getAgaEngine() === 'gemini';
}

export function isElevenLabsAgentEngine() {
  return getAgaEngine() === 'elevenlabs_agent';
}

export function isLocalEngine() {
  return getAgaEngine() === 'local';
}

export function isOpenAiRealtimeBlocked() {
  if (AGA_CONFIG.brain.disableOpenAi) return true;
  return getAgaEngine() !== 'openai';
}

export function shouldUseDirectOpenAiRealtime() {
  return getAgaEngine() === 'openai' && envFlag('EXPO_PUBLIC_AGA_REALTIME_DIRECT', false);
}

export function shouldLoadOpenAiRealtimeModule() {
  return getAgaEngine() === 'openai';
}

export function agaEngineDiagnostics() {
  const decision = getAgaEngineDecision();
  return {
    engine: decision.engine,
    source: decision.source,
    raw: decision.raw,
    EXPO_PUBLIC_AGA_ENGINE: env('EXPO_PUBLIC_AGA_ENGINE') || null,
    EXPO_PUBLIC_AGA_REALTIME_DIRECT: env('EXPO_PUBLIC_AGA_REALTIME_DIRECT') || null,
    EXPO_PUBLIC_AGA_PROVIDER: env('EXPO_PUBLIC_AGA_PROVIDER') || null,
    EXPO_PUBLIC_AGA_BRAIN_PROVIDER: env('EXPO_PUBLIC_AGA_BRAIN_PROVIDER') || null,
    EXPO_PUBLIC_AGA_DISABLE_OPENAI: env('EXPO_PUBLIC_AGA_DISABLE_OPENAI') || null,
    hasElevenLabsAgent: !!(env('EXPO_PUBLIC_ELEVENLABS_AGENT_ID') || env('EXPO_PUBLIC_ELEVENLABS_AGENT_SIGNED_URL_ENDPOINT') || env('EXPO_PUBLIC_AGA_ELEVENLABS_AGENT_SIGNED_URL_ENDPOINT')),
    hasGeminiKey: !!(env('EXPO_PUBLIC_GEMINI_API_KEY') || env('EXPO_PUBLIC_GOOGLE_API_KEY')),
    hasOpenAiKey: !!env('EXPO_PUBLIC_OPENAI_API_KEY'),
    hasRealtimeTokenUrl: !!env('EXPO_PUBLIC_AGA_REALTIME_TOKEN_URL'),
    openAiRealtimeBlocked: isOpenAiRealtimeBlocked(),
    openAiModuleShouldLoad: shouldLoadOpenAiRealtimeModule(),
    liveSessionPolicy: AGA_CONFIG.brain.liveSessionPolicy,
  };
}
