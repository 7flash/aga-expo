export type VoiceSecretPolicy = {
  safeForProduction: boolean;
  issues: string[];
  recommendations: string[];
};

function env(name: string) {
  return process.env?.[name] ?? '';
}

export function getVoiceSecretPolicy(): VoiceSecretPolicy {
  const issues: string[] = [];
  const recommendations: string[] = [];
  const publicKey = env('EXPO_PUBLIC_ELEVENLABS_API_KEY');
  const gateway = env('EXPO_PUBLIC_AGA_TTS_GATEWAY_URL');
  const assistantUrl = env('EXPO_PUBLIC_ASSISTANT_WEB_URL');
  const directAllowed = String(env('EXPO_PUBLIC_AGA_ALLOW_DIRECT_ELEVENLABS') || '0') !== '0';

  if (publicKey) issues.push('EXPO_PUBLIC_ELEVENLABS_API_KEY is visible to the Android bundle.');
  if (!gateway && (!assistantUrl || /localhost|127\.0\.0\.1/.test(assistantUrl))) issues.push('No production TTS gateway is configured.');
  if (directAllowed) issues.push('Direct device-to-ElevenLabs calls are enabled.');

  recommendations.push('Keep ELEVENLABS_API_KEY server-side only.');
  recommendations.push('Expose only EXPO_PUBLIC_AGA_TTS_GATEWAY_URL to the APK.');
  recommendations.push('Set EXPO_PUBLIC_AGA_ALLOW_DIRECT_ELEVENLABS=0 for preview/production builds.');

  return { safeForProduction: issues.length === 0, issues, recommendations };
}
