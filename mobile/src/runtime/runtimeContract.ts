import { AGA_ARCHITECTURE_FLAGS, describeArchitectureFlags } from './architectureFlags';

export type RuntimeContractIssue = {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
};

function has(name: string) {
  return !!String(process.env[name] ?? '').trim();
}

export function getRuntimeContractIssues(): RuntimeContractIssue[] {
  const issues: RuntimeContractIssue[] = [];
  const f = AGA_ARCHITECTURE_FLAGS;

  if (f.wakeEngine === 'porcupine') {
    issues.push({
      severity: 'warning',
      code: 'wake.legacy_porcupine',
      message: 'Porcupine is configured as a fallback. Production appliance mode should use Sherpa KWS for aga/stop/pause.',
    });
  }

  if (f.wakeEngine === 'disabled') {
    issues.push({ severity: 'error', code: 'wake.disabled', message: 'Wake engine is disabled. A no-touch appliance needs Sherpa KWS.' });
  }

  if (f.shortTtsProvider === 'elevenlabs' && !has('EXPO_PUBLIC_AGA_TTS_GATEWAY_URL') && !has('EXPO_PUBLIC_ELEVENLABS_API_KEY')) {
    issues.push({ severity: 'error', code: 'tts.elevenlabs_missing', message: 'ElevenLabs is selected but no API key or TTS gateway URL is configured.' });
  }

  if (f.shortTtsProvider === 'openai' && !has('EXPO_PUBLIC_AGA_TTS_GATEWAY_URL') && !has('EXPO_PUBLIC_OPENAI_API_KEY')) {
    issues.push({ severity: 'error', code: 'tts.openai_missing', message: 'OpenAI TTS is selected but no API key or TTS gateway URL is configured.' });
  }

  if (!['true_hologram', 'tactile_relic', 'tactile_aga'].includes(f.displayMode)) {
    issues.push({ severity: 'warning', code: 'display.not_holographic', message: `Display mode is ${f.displayMode}. Behind-glass builds should use true_hologram or tactile_relic.` });
  }

  if (!f.pureDisplay) {
    issues.push({ severity: 'warning', code: 'display.touch_allowed', message: 'Pure display mode is disabled. Behind-glass builds should avoid touch-only UI.' });
  }

  if (!f.deterministicGuidedSessions) {
    issues.push({ severity: 'warning', code: 'guided.model_paced', message: 'Deterministic guided sessions are disabled. Hypnosis/breathing pacing may drift.' });
  }

  return issues;
}

export function summarizeRuntimeContract() {
  const issues = getRuntimeContractIssues();
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  return `AGA runtime contract: ${describeArchitectureFlags()}. ${errors} errors, ${warnings} warnings.`;
}

export function assertRuntimeContract() {
  const issues = getRuntimeContractIssues();
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length) {
    throw new Error(errors.map((i) => `${i.code}: ${i.message}`).join('\n'));
  }
  return issues;
}
