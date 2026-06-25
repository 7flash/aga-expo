import { Platform } from 'react-native';

declare function require(name: string): any;

export type VoiceCapability = {
  platform: string;
  speechRecognition: 'native' | 'web' | 'missing';
  speechSynthesis: 'web' | 'expo-speech' | 'missing';
  alwaysOnExpectation: 'native-build' | 'browser-limited' | 'unknown';
  notes: string[];
};

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

export function getVoiceCapability(): VoiceCapability {
  const nativeVoice = hasNativeVoiceModule();
  const webRecognition = hasWebSpeechRecognition();
  const webTts = hasWebSpeechSynthesis();
  const expoTts = hasExpoSpeech();
  const notes: string[] = [];

  if (Platform.OS === 'web') {
    notes.push('Web is a test harness; browser speech APIs may stop after no-speech and may restrict audio output.');
    if (!webRecognition) notes.push('Browser SpeechRecognition/webkitSpeechRecognition is unavailable.');
    if (!webTts && !expoTts) notes.push('No web or expo-speech TTS provider is available.');
  } else {
    if (!nativeVoice) notes.push('@react-native-voice/voice native module is missing; rebuild the dev client/APK.');
    if (!expoTts) notes.push('expo-speech is missing; voice output will be bubble-only.');
  }

  return {
    platform: Platform.OS,
    speechRecognition: nativeVoice ? 'native' : webRecognition ? 'web' : 'missing',
    speechSynthesis: webTts ? 'web' : expoTts ? 'expo-speech' : 'missing',
    alwaysOnExpectation: Platform.OS === 'web' ? 'browser-limited' : nativeVoice ? 'native-build' : 'unknown',
    notes,
  };
}

export function summarizeVoiceCapability(capability = getVoiceCapability()) {
  const recognition = capability.speechRecognition;
  const output = capability.speechSynthesis;
  if (recognition === 'missing') {
    return `voice recognition unavailable on ${capability.platform}`;
  }
  if (output === 'missing') {
    return `listening:${recognition}; voice output unavailable`;
  }
  return `listening:${recognition}; speaking:${output}`;
}
