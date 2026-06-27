import { AGA_CONFIG, summarizeAgaConfig } from '../config/agaConfig';

export type RuntimeContractIssue = {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
};

export function getRuntimeContractIssues(): RuntimeContractIssue[] {
  const issues: RuntimeContractIssue[] = [];
  const config = AGA_CONFIG;

  if (config.wake.engine === 'disabled') {
    issues.push({ severity: 'error', code: 'wake.disabled', message: 'Wake engine is disabled. A no-touch appliance needs Sherpa KWS for wake/control words.' });
  }

  if (config.wake.engine === 'porcupine') {
    issues.push({ severity: 'warning', code: 'wake.legacy_porcupine', message: 'Porcupine is configured as the primary wake engine. Production appliance mode should use Sherpa KWS, with Porcupine only as fallback.' });
  }

  if (/sherpa/.test(config.wake.engine) && !config.wake.sherpaModelDir) {
    issues.push({ severity: 'error', code: 'wake.sherpa_assets_missing', message: 'Sherpa is selected but no Sherpa model directory is configured.' });
  }

  if (/sherpa/.test(config.wake.engine) && config.wake.sherpaKeywords.length < 1) {
    issues.push({ severity: 'error', code: 'wake.no_keywords', message: 'Sherpa is selected but no wake/control keywords are configured.' });
  }

  if (config.tts.provider === 'elevenlabs' && !config.tts.gatewayUrl && !config.tts.elevenLabsApiKeyPresent) {
    issues.push({ severity: 'error', code: 'tts.elevenlabs_missing', message: 'ElevenLabs is selected but no TTS gateway URL or ElevenLabs key is configured.' });
  }

  if (config.tts.provider === 'openai' && !config.tts.gatewayUrl && !config.tts.openAiApiKeyPresent) {
    issues.push({ severity: 'error', code: 'tts.openai_missing', message: 'OpenAI TTS is selected but no TTS gateway URL or OpenAI key is configured.' });
  }

  if (!config.security.allowDirectKeys && (config.tts.elevenLabsApiKeyPresent || config.tts.openAiApiKeyPresent)) {
    issues.push({ severity: 'warning', code: 'security.public_keys_present', message: 'Direct EXPO_PUBLIC API keys are present while direct keys are disabled. Production builds should use secureSecrets or gateway endpoints.' });
  }

  if (config.brain.liveEngine === 'elevenlabs_agent' && !config.elevenLabsAgent.agentId && !config.elevenLabsAgent.signedUrlEndpoint) {
    issues.push({ severity: 'error', code: 'live.elevenlabs_agent_missing', message: 'ElevenLabs Agent live mode needs EXPO_PUBLIC_ELEVENLABS_AGENT_ID for a public agent or EXPO_PUBLIC_ELEVENLABS_AGENT_SIGNED_URL_ENDPOINT for a private agent.' });
  }

  if (config.brain.liveEngine === 'elevenlabs_agent' && !config.elevenLabsAgent.signedUrlEndpoint && !config.security.allowDirectKeys) {
    issues.push({ severity: 'info', code: 'live.elevenlabs_public_agent', message: 'ElevenLabs Agent is using a public agent_id directly. Private agents should use a server signed URL endpoint; never expose xi-api-key in the client.' });
  }

  if (!['true_hologram', 'tactile_relic', 'tactile_aga'].includes(config.display.mode)) {
    issues.push({ severity: 'warning', code: 'display.not_holographic', message: `Display mode is ${config.display.mode}. Behind-glass builds should use true_hologram or tactile_relic.` });
  }

  if (!config.display.pureDisplay) {
    issues.push({ severity: 'warning', code: 'display.touch_allowed', message: 'Pure display mode is disabled. Behind-glass builds should avoid touch-only UI.' });
  }

  if (!config.appliance.deterministicGuidedSessions) {
    issues.push({ severity: 'warning', code: 'guided.model_paced', message: 'Deterministic guided sessions are disabled. Hypnosis/breathing pacing may drift.' });
  }

  return issues;
}

export function summarizeRuntimeContract() {
  const issues = getRuntimeContractIssues();
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  return `AGA runtime contract: ${summarizeAgaConfig()}. ${errors} errors, ${warnings} warnings.`;
}

export function assertRuntimeContract() {
  const issues = getRuntimeContractIssues();
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length) {
    throw new Error(errors.map((i) => `${i.code}: ${i.message}`).join('\n'));
  }
  return issues;
}
