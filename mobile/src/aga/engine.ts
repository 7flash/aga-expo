export type AgaEngine = 'gemini' | 'openai' | 'local';

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

/**
 * Canonical engine selector.
 *
 * EXPO_PUBLIC_AGA_ENGINE is the highest-priority switch. If it says gemini,
 * older env flags such as EXPO_PUBLIC_AGA_REALTIME_DIRECT=1 or a stale
 * EXPO_PUBLIC_AGA_PROVIDER=openai must not start OpenAI Realtime.
 */
export function getAgaEngine(): AgaEngine {
  const explicit = parseEngine(env('EXPO_PUBLIC_AGA_ENGINE'));
  if (explicit) return explicit;

  const runtimeEngine = parseEngine(env('EXPO_PUBLIC_AGA_RUNTIME_ENGINE'));
  if (runtimeEngine) return runtimeEngine;

  const brainProvider = parseEngine(env('EXPO_PUBLIC_AGA_BRAIN_PROVIDER'));
  if (brainProvider) return brainProvider;

  const provider = parseEngine(env('EXPO_PUBLIC_AGA_PROVIDER'));
  if (provider) return provider;

  const voiceEngine = parseEngine(env('EXPO_PUBLIC_AGA_VOICE_ENGINE'));
  if (voiceEngine) return voiceEngine;

  // Cost-safe auto default: if Gemini is configured and OpenAI is not, use Gemini.
  const hasGemini = !!(env('EXPO_PUBLIC_GEMINI_API_KEY') || env('EXPO_PUBLIC_GOOGLE_API_KEY'));
  const hasOpenAI = !!(env('EXPO_PUBLIC_OPENAI_API_KEY') || env('EXPO_PUBLIC_AGA_REALTIME_TOKEN_URL') || env('EXPO_PUBLIC_AGA_REALTIME_SDP_URL'));
  if (hasGemini && !hasOpenAI) return 'gemini';
  if (envFlag('EXPO_PUBLIC_AGA_PREFER_GEMINI', false) && hasGemini) return 'gemini';

  return 'openai';
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

export function agaEngineDiagnostics() {
  return {
    engine: getAgaEngine(),
    EXPO_PUBLIC_AGA_ENGINE: env('EXPO_PUBLIC_AGA_ENGINE') || null,
    EXPO_PUBLIC_AGA_REALTIME_DIRECT: env('EXPO_PUBLIC_AGA_REALTIME_DIRECT') || null,
    hasGeminiKey: !!(env('EXPO_PUBLIC_GEMINI_API_KEY') || env('EXPO_PUBLIC_GOOGLE_API_KEY')),
    hasOpenAiKey: !!env('EXPO_PUBLIC_OPENAI_API_KEY'),
    hasRealtimeTokenUrl: !!env('EXPO_PUBLIC_AGA_REALTIME_TOKEN_URL'),
    openAiRealtimeBlocked: isOpenAiRealtimeBlocked(),
  };
}
