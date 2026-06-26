export type VoiceCapability = {
  wakeEngine: string;
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

function listEnv(name: string) {
  return String(env(name) || '').split(',').map((x) => x.trim()).filter(Boolean);
}

export function getVoiceCapability(): VoiceCapability {
  return {
    wakeEngine: env('EXPO_PUBLIC_AGA_WAKE_ENGINE') || 'porcupine',
    porcupineConfigured: !!env('EXPO_PUBLIC_AGA_PORCUPINE_ACCESS_KEY') && listEnv('EXPO_PUBLIC_AGA_PORCUPINE_KEYWORD_PATHS').length >= 1,
    porcupineKeywordPaths: listEnv('EXPO_PUBLIC_AGA_PORCUPINE_KEYWORD_PATHS'),
    ttsProvider: env('EXPO_PUBLIC_AGA_TTS_PROVIDER') || 'elevenlabs',
    elevenLabsConfigured: !!env('EXPO_PUBLIC_ELEVENLABS_API_KEY') && !!env('EXPO_PUBLIC_ELEVENLABS_VOICE_ID'),
    openAiTtsConfigured: !!env('EXPO_PUBLIC_OPENAI_API_KEY'),
    liveEngine: env('EXPO_PUBLIC_AGA_ENGINE') || 'gemini',
    nativeSpeechFallback: env('EXPO_PUBLIC_AGA_WAKE_ENGINE') !== 'porcupine',
  };
}

export function summarizeVoiceCapability(cap = getVoiceCapability()) {
  const wake = cap.porcupineConfigured ? `Porcupine ${cap.porcupineKeywordPaths.join(', ')}` : 'Porcupine not configured';
  const tts = cap.elevenLabsConfigured ? 'ElevenLabs ready' : cap.openAiTtsConfigured ? 'OpenAI TTS ready' : 'system TTS fallback only';
  return `${wake}; ${tts}; live engine ${cap.liveEngine}.`;
}
