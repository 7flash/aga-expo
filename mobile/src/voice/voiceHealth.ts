import { Platform } from 'react-native';
import { isElevenLabsConfigured } from './elevenLabsTts';
import { isTtsGatewayConfigured } from './ttsGateway';

declare function require(name: string): any;

export type VoiceCapability = {
  platform: string;
  speechRecognition: 'native' | 'web' | 'missing';
  speechSynthesis: 'elevenlabs-gateway' | 'elevenlabs-direct' | 'web' | 'expo-speech' | 'missing';
  expressiveTts: boolean;
  secureTts: boolean;
  alwaysOnExpectation: 'native-build' | 'browser-limited' | 'unknown';
  notes: string[];
};

function env(name: string) {
  return process.env?.[name] ?? '';
}

function hasWebSpeechRecognition() {
  if (Platform.OS !== 'web') return false;
  const root: any = globalThis as any;
  return Boolean(root.SpeechRecognition || root.webkitSpeechRecognition);
}

function hasWebSpeechSynthesis() {
  if (Platform.OS !== 'web') return false;
  const root: any = globalThis as any;
  return Boolean(root.speechSynthesis && root.SpeechSynthesisUtterance);
}

function hasExpoSpeech() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Speech = require('expo-speech');
    return Boolean(Speech?.speak);
  } catch {
    return false;
  }
}

function hasNativeVoiceModule() {
  if (Platform.OS === 'web') return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-voice/voice');
    const Voice = mod?.default ?? mod;
    return Boolean(Voice?.start);
  } catch {
    return false;
  }
}

function hasNativeElevenPlayback() {
  if (Platform.OS === 'web') return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Audio = require('expo-av')?.Audio;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const FileSystem = require('expo-file-system');
    return Boolean(Audio?.Sound?.createAsync && FileSystem?.writeAsStringAsync);
  } catch {
    return false;
  }
}

function directKeyPresent() {
  return Boolean(env('EXPO_PUBLIC_ELEVENLABS_API_KEY') || env('ELEVENLABS_API_KEY'));
}

export function getVoiceCapability(): VoiceCapability {
  const nativeVoice = hasNativeVoiceModule();
  const webRecognition = hasWebSpeechRecognition();
  const webTts = hasWebSpeechSynthesis();
  const expoTts = hasExpoSpeech();
  const gateway = isTtsGatewayConfigured();
  const elevenConfigured = isElevenLabsConfigured();
  const elevenPlayback = hasNativeElevenPlayback();
  const elevenReady = elevenConfigured && elevenPlayback;
  const notes: string[] = [];

  if (Platform.OS === 'web') {
    notes.push('Web remains a test harness; browser speech APIs may stop after no-speech and may restrict audio output.');
    if (!webRecognition) notes.push('Browser SpeechRecognition/webkitSpeechRecognition is unavailable.');
  } else {
    if (!nativeVoice) notes.push('@react-native-voice/voice native module is missing; rebuild the dev client/APK.');
    if (!elevenPlayback) notes.push('Install/rebuild expo-av and expo-file-system so expressive audio can play on Android.');
    if (!expoTts) notes.push('expo-speech fallback is missing; emergency offline speech will be unavailable.');
  }

  if (!gateway && directKeyPresent()) notes.push('Direct ElevenLabs key is present on device. Use EXPO_PUBLIC_AGA_TTS_GATEWAY_URL for production.');
  if (!gateway && !directKeyPresent()) notes.push('No ElevenLabs gateway or direct dev key is configured; local/tool replies will fall back to flatter voices.');
  if (gateway) notes.push('Expressive TTS is routed through the AGA gateway, keeping ElevenLabs secrets off the device.');

  return {
    platform: Platform.OS,
    speechRecognition: nativeVoice ? 'native' : webRecognition ? 'web' : 'missing',
    speechSynthesis: elevenReady ? (gateway ? 'elevenlabs-gateway' : 'elevenlabs-direct') : webTts ? 'web' : expoTts ? 'expo-speech' : 'missing',
    expressiveTts: elevenReady,
    secureTts: gateway,
    alwaysOnExpectation: Platform.OS === 'web' ? 'browser-limited' : nativeVoice ? 'native-build' : 'unknown',
    notes,
  };
}
