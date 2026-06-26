export type AgaEngine = 'gemini' | 'openai' | 'local';

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
 * Canonical engine selector.
 *
 * EXPO_PUBLIC_AGA_ENGINE is the highest-priority switch. If it says gemini,
 * older env flags such as EXPO_PUBLIC_AGA_REALTIME_DIRECT=1 or a stale
 * EXPO_PUBLIC_AGA_PROVIDER=openai must not start OpenAI Realtime.
 */
export function getAgaEngineDecision(): EngineDecision {
  return decisionFrom('EXPO_PUBLIC_AGA_ENGINE')
    ?? decisionFrom('EXPO_PUBLIC_AGA_RUNTIME_ENGINE')
    ?? decisionFrom('EXPO_PUBLIC_AGA_BRAIN_PROVIDER')
    ?? decisionFrom('EXPO_PUBLIC_AGA_PROVIDER')
    ?? decisionFrom('EXPO_PUBLIC_AGA_VOICE_ENGINE')
    ?? (() => {
      const hasGemini = !!(env('EXPO_PUBLIC_GEMINI_API_KEY') || env('EXPO_PUBLIC_GOOGLE_API_KEY'));
      const hasOpenAI = !!(env('EXPO_PUBLIC_OPENAI_API_KEY') || env('EXPO_PUBLIC_AGA_REALTIME_TOKEN_URL') || env('EXPO_PUBLIC_AGA_REALTIME_SDP_URL'));
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

export function isLocalEngine() {
  return getAgaEngine() === 'local';
}

export function isOpenAiRealtimeBlocked() {
  if (envFlag('EXPO_PUBLIC_AGA_DISABLE_OPENAI', false)) return true;
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
    hasGeminiKey: !!(env('EXPO_PUBLIC_GEMINI_API_KEY') || env('EXPO_PUBLIC_GOOGLE_API_KEY')),
    hasOpenAiKey: !!env('EXPO_PUBLIC_OPENAI_API_KEY'),
    hasRealtimeTokenUrl: !!env('EXPO_PUBLIC_AGA_REALTIME_TOKEN_URL'),
    openAiRealtimeBlocked: isOpenAiRealtimeBlocked(),
    openAiModuleShouldLoad: shouldLoadOpenAiRealtimeModule(),
  };
}
