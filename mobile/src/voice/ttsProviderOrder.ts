export type TtsProviderName = 'elevenlabs' | 'openai' | 'system';

export function getTtsProviderOrder(): TtsProviderName[] {
  const preferred = String(process.env.EXPO_PUBLIC_AGA_SHORT_TTS_PROVIDER || 'elevenlabs').toLowerCase();
  const order: TtsProviderName[] = [];
  if (preferred === 'elevenlabs') order.push('elevenlabs');
  if (preferred === 'openai') order.push('openai');
  if (!order.includes('elevenlabs')) order.push('elevenlabs');
  if (!order.includes('openai')) order.push('openai');
  if (String(process.env.EXPO_PUBLIC_AGA_EMERGENCY_SYSTEM_TTS ?? '1') !== '0') order.push('system');
  return order;
}

export function describeTtsOrder() {
  return `Short TTS provider order: ${getTtsProviderOrder().join(' → ')}.`;
}
