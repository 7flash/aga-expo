import { AGA_CONFIG } from '../config/agaConfig';

export type VoiceCapability = {
  wakeEngine: string;
  browserWakeEngine: string;
  sherpaConfigured: boolean;
  sherpaModelDir: string;
  wakeKeywords: string[];
  porcupineConfigured: boolean;
  porcupineKeywordPaths: string[];
  ttsProvider: string;
  elevenLabsConfigured: boolean;
  ttsGatewayConfigured: boolean;
  openAiTtsConfigured: boolean;
  liveEngine: string;
  liveSessionPolicy: string;
  nativeSpeechFallback: boolean;
  directPublicKeysAllowed: boolean;
};

function env(name: string) {
  return process.env?.[name] ?? '';
}

function listEnv(name: string, fallback = '') {
  return String(env(name) || fallback).split(',').map((x) => x.trim()).filter(Boolean);
}

export function getVoiceCapability(): VoiceCapability {
  const config = AGA_CONFIG;
  return {
    wakeEngine: config.wake.engine,
    browserWakeEngine: config.wake.browserEngine,
    sherpaConfigured: /sherpa/i.test(config.wake.engine) && !!config.wake.sherpaModelDir,
    sherpaModelDir: config.wake.sherpaModelDir,
    wakeKeywords: [...config.wake.sherpaKeywords],
    porcupineConfigured: !!env('EXPO_PUBLIC_AGA_PORCUPINE_ACCESS_KEY') && listEnv('EXPO_PUBLIC_AGA_PORCUPINE_KEYWORD_PATHS').length >= 1,
    porcupineKeywordPaths: listEnv('EXPO_PUBLIC_AGA_PORCUPINE_KEYWORD_PATHS'),
    ttsProvider: config.tts.provider,
    elevenLabsConfigured: Boolean(config.tts.gatewayUrl || config.tts.elevenLabsApiKeyPresent) && !!config.tts.elevenLabsVoiceId,
    ttsGatewayConfigured: !!config.tts.gatewayUrl,
    openAiTtsConfigured: config.tts.openAiApiKeyPresent,
    liveEngine: config.brain.liveEngine,
    liveSessionPolicy: config.brain.liveSessionPolicy,
    nativeSpeechFallback: !/sherpa/i.test(config.wake.engine),
    directPublicKeysAllowed: config.security.allowDirectKeys,
  };
}

export function summarizeVoiceCapability(cap = getVoiceCapability()) {
  const wake = cap.sherpaConfigured ? `Sherpa ${cap.sherpaModelDir} [${cap.wakeKeywords.join(', ')}]` : `Wake ${cap.wakeEngine}`;
  const tts = cap.elevenLabsConfigured ? (cap.ttsGatewayConfigured ? 'ElevenLabs gateway ready' : 'ElevenLabs direct ready') : cap.openAiTtsConfigured ? 'OpenAI TTS ready' : 'system TTS fallback only';
  return `${wake}; ${tts}; live ${cap.liveEngine}/${cap.liveSessionPolicy}.`;
}
