export type VoiceCapability = {
  wakeEngine: string;
  sherpaConfigured: boolean;
  sherpaModelDir: string;
  wakeKeywords: string[];
  porcupineConfigured: boolean;
  porcupineKeywordPaths: string[];
  ttsProvider: string;
  elevenLabsConfigured: boolean;
  openAiTtsConfigured: boolean;
  liveEngine: string;
  nativeSpeechFallback: boolean;
};

function env(name: string) {
  return process.env?.[name] ?? '';
}

function listEnv(name: string, fallback = '') {
  return String(env(name) || fallback).split(',').map((x) => x.trim()).filter(Boolean);
}

export function getVoiceCapability(): VoiceCapability {
  const wakeEngine = env('EXPO_PUBLIC_AGA_KEYWORD_ENGINE') || env('EXPO_PUBLIC_AGA_WAKE_ENGINE') || 'sherpa';
  const sherpaModelDir = env('EXPO_PUBLIC_AGA_SHERPA_MODEL_DIR') || 'assets/kws-model';
  return {
    wakeEngine,
    sherpaConfigured: /sherpa/i.test(wakeEngine) && !!sherpaModelDir,
    sherpaModelDir,
    wakeKeywords: listEnv('EXPO_PUBLIC_AGA_SHERPA_WAKE_KEYWORDS', 'aga,stop,pause'),
    porcupineConfigured: !!env('EXPO_PUBLIC_AGA_PORCUPINE_ACCESS_KEY') && listEnv('EXPO_PUBLIC_AGA_PORCUPINE_KEYWORD_PATHS').length >= 1,
    porcupineKeywordPaths: listEnv('EXPO_PUBLIC_AGA_PORCUPINE_KEYWORD_PATHS'),
    ttsProvider: env('EXPO_PUBLIC_AGA_SHORT_TTS_PROVIDER') || env('EXPO_PUBLIC_AGA_TTS_PROVIDER') || 'elevenlabs',
    elevenLabsConfigured: (!!env('EXPO_PUBLIC_AGA_TTS_GATEWAY_URL') || !!env('EXPO_PUBLIC_ELEVENLABS_API_KEY')) && !!env('EXPO_PUBLIC_ELEVENLABS_VOICE_ID'),
    openAiTtsConfigured: !!env('EXPO_PUBLIC_OPENAI_API_KEY'),
    liveEngine: env('EXPO_PUBLIC_AGA_ENGINE') || 'gemini',
    nativeSpeechFallback: !/sherpa/i.test(wakeEngine),
  };
}

export function summarizeVoiceCapability(cap = getVoiceCapability()) {
  const wake = cap.sherpaConfigured ? `Sherpa ${cap.sherpaModelDir} [${cap.wakeKeywords.join(', ')}]` : `Wake ${cap.wakeEngine}`;
  const tts = cap.elevenLabsConfigured ? 'ElevenLabs/gateway ready' : cap.openAiTtsConfigured ? 'OpenAI TTS ready' : 'system TTS fallback only';
  return `${wake}; ${tts}; live engine ${cap.liveEngine}.`;
}
