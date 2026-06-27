export type AgaWakeEngineKind = 'sherpa' | 'sherpa_wasm' | 'sherpa_native' | 'porcupine' | 'dev' | 'disabled';
export type AgaShortTtsProvider = 'elevenlabs' | 'openai' | 'system' | 'silent';
export type AgaLiveSessionPolicy = 'never' | 'explicit_only' | 'casual_by_default' | 'most_requests' | 'always';
export type AgaLiveEngine = 'gemini' | 'openai' | 'local';
export type AgaDisplayMode = 'true_hologram' | 'tactile_relic' | 'tactile_aga' | 'hologram' | 'zen' | 'debug';

function rawEnv(name: string, fallback = '') {
  return String((process as any)?.env?.[name] ?? fallback).trim();
}

function normalizeToken(value: string) {
  return String(value || '').trim().toLowerCase().replace(/-/g, '_');
}

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  const clean = normalizeToken(value);
  return (allowed as readonly string[]).includes(clean) ? clean as T : fallback;
}

function flag(name: string, fallback = false) {
  const raw = normalizeToken(rawEnv(name, fallback ? '1' : '0'));
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

function numberEnv(name: string, fallback: number) {
  const n = Number(rawEnv(name));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function listEnv(name: string, fallback = '') {
  return rawEnv(name, fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function wakeEngine() {
  return oneOf<AgaWakeEngineKind>(
    rawEnv('EXPO_PUBLIC_AGA_KEYWORD_ENGINE', rawEnv('EXPO_PUBLIC_AGA_WAKE_ENGINE', 'sherpa')),
    ['sherpa', 'sherpa_wasm', 'sherpa_native', 'porcupine', 'dev', 'disabled'],
    'sherpa',
  );
}

function browserWakeEngine(wake: AgaWakeEngineKind) {
  return oneOf<AgaWakeEngineKind>(
    rawEnv('EXPO_PUBLIC_AGA_BROWSER_KEYWORD_ENGINE', wake === 'sherpa' || wake === 'sherpa_native' ? 'sherpa_wasm' : wake),
    ['sherpa', 'sherpa_wasm', 'sherpa_native', 'porcupine', 'dev', 'disabled'],
    'sherpa_wasm',
  );
}

function liveEngine() {
  return oneOf<AgaLiveEngine>(rawEnv('EXPO_PUBLIC_AGA_ENGINE', 'gemini'), ['gemini', 'openai', 'local'], 'gemini');
}

const selectedWakeEngine = wakeEngine();

export const AGA_CONFIG = Object.freeze({
  assistantWebUrl: rawEnv('EXPO_PUBLIC_ASSISTANT_WEB_URL', 'http://localhost:3000'),
  display: Object.freeze({
    mode: oneOf<AgaDisplayMode>(
      rawEnv('EXPO_PUBLIC_AGA_DISPLAY_MODE', 'true_hologram'),
      ['true_hologram', 'tactile_relic', 'tactile_aga', 'hologram', 'zen', 'debug'],
      'true_hologram',
    ),
    pureDisplay: flag('EXPO_PUBLIC_AGA_PURE_DISPLAY', true),
    mirror: flag('EXPO_PUBLIC_AGA_DISPLAY_MIRROR', false),
  }),
  wake: Object.freeze({
    engine: selectedWakeEngine,
    browserEngine: browserWakeEngine(selectedWakeEngine),
    fallbackEngine: oneOf<AgaWakeEngineKind>(
      rawEnv('EXPO_PUBLIC_AGA_FALLBACK_KEYWORD_ENGINE', 'porcupine'),
      ['sherpa', 'sherpa_wasm', 'sherpa_native', 'porcupine', 'dev', 'disabled'],
      'porcupine',
    ),
    allowDevKeywordInjector: flag('EXPO_PUBLIC_AGA_ALLOW_DEV_KEYWORD_INJECTOR', false),
    wakeWord: rawEnv('EXPO_PUBLIC_AGA_WAKE_WORD', 'aga'),
    sherpaKeywords: listEnv('EXPO_PUBLIC_AGA_SHERPA_WAKE_KEYWORDS', 'aga,stop,pause'),
    sherpaModelDir: rawEnv('EXPO_PUBLIC_AGA_SHERPA_MODEL_DIR', 'assets/kws-model'),
    sherpaWasmModelUrl: rawEnv('EXPO_PUBLIC_AGA_SHERPA_WASM_MODEL_URL', '/sherpa/kws-model'),
    postWakeCommandWindowMs: numberEnv('EXPO_PUBLIC_AGA_POST_WAKE_COMMAND_WINDOW_MS', 8000),
    postWakeTtsAck: flag('EXPO_PUBLIC_AGA_POST_WAKE_TTS_ACK', true),
    postWakeReply: rawEnv('EXPO_PUBLIC_AGA_POST_WAKE_REPLY', 'Yes?'),
  }),
  brain: Object.freeze({
    liveEngine: liveEngine(),
    liveSessionPolicy: oneOf<AgaLiveSessionPolicy>(
      rawEnv('EXPO_PUBLIC_AGA_LIVE_SESSION_POLICY', rawEnv('EXPO_PUBLIC_AGA_LIVE_ESCALATION', 'casual_by_default')),
      ['never', 'explicit_only', 'casual_by_default', 'most_requests', 'always'],
      'casual_by_default',
    ),
    defaultReasoningPath: rawEnv('EXPO_PUBLIC_AGA_DEFAULT_REASONING_PATH', 'stt_gpt5_tts'),
    disableOpenAi: flag('EXPO_PUBLIC_AGA_DISABLE_OPENAI', false),
    clearTransientOnBoot: flag('EXPO_PUBLIC_AGA_CLEAR_TRANSIENT_ON_BOOT', true),
    freshContextPerWake: flag('EXPO_PUBLIC_AGA_FRESH_CONTEXT_PER_WAKE', true),
  }),
  tts: Object.freeze({
    provider: oneOf<AgaShortTtsProvider>(
      rawEnv('EXPO_PUBLIC_AGA_SHORT_TTS_PROVIDER', rawEnv('EXPO_PUBLIC_AGA_TTS_PROVIDER', 'elevenlabs')),
      ['elevenlabs', 'openai', 'system', 'silent'],
      'elevenlabs',
    ),
    gatewayUrl: rawEnv('EXPO_PUBLIC_AGA_TTS_GATEWAY_URL', ''),
    elevenLabsVoiceId: rawEnv('EXPO_PUBLIC_ELEVENLABS_VOICE_ID', ''),
    elevenLabsApiKeyPresent: Boolean(rawEnv('EXPO_PUBLIC_ELEVENLABS_API_KEY', '')),
    openAiApiKeyPresent: Boolean(rawEnv('EXPO_PUBLIC_OPENAI_API_KEY', '')),
  }),
  appliance: Object.freeze({
    requireNativeAec: flag('EXPO_PUBLIC_AGA_REQUIRE_NATIVE_AEC', true),
    wakeForegroundService: flag('EXPO_PUBLIC_AGA_WAKE_FOREGROUND_SERVICE', true),
    liveSpeakerphone: flag('EXPO_PUBLIC_AGA_LIVE_SPEAKERPHONE', true),
    tier3AecRequired: flag('EXPO_PUBLIC_AGA_TIER3_AEC_REQUIRED', true),
    deterministicGuidedSessions: flag('EXPO_PUBLIC_AGA_DETERMINISTIC_GUIDED', true),
    emergencySystemTts: flag('EXPO_PUBLIC_AGA_EMERGENCY_SYSTEM_TTS', true),
  }),
  security: Object.freeze({
    // Default false: EXPO_PUBLIC keys are bundled into browser/mobile builds.
    // Production should use secureSecrets or a gateway for OpenAI/Gemini/ElevenLabs.
    allowDirectKeys: flag('EXPO_PUBLIC_AGA_ALLOW_DIRECT_KEYS', false),
  }),
});

export function getAgaConfig() {
  return AGA_CONFIG;
}

export function summarizeAgaConfig(config = AGA_CONFIG) {
  return [
    `wake=${config.wake.engine}`,
    `browserWake=${config.wake.browserEngine}`,
    `keywords=${config.wake.sherpaKeywords.join('/')}`,
    `live=${config.brain.liveEngine}:${config.brain.liveSessionPolicy}`,
    `tts=${config.tts.provider}`,
    `display=${config.display.mode}`,
    `directKeys=${config.security.allowDirectKeys ? 'allowed' : 'blocked'}`,
  ].join(' ');
}
