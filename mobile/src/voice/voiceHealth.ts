import { Platform } from 'react-native';
import { isElevenLabsConfigured } from './elevenLabsTts';

declare function require(name: string): any;

export type VoiceCapability = {
  platform: string;
  speechRecognition: 'native' | 'web' | 'missing';
  speechSynthesis: 'elevenlabs' | 'web' | 'expo-speech' | 'missing';
  expressiveTts: boolean;
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

function hasNativeElevenPlayback() {
  if (Platform.OS === 'web') return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const FileSystem = require('expo-file-system');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Audio = require('expo-av')?.Audio;
    return Boolean(FileSystem?.writeAsStringAsync && Audio?.Sound?.createAsync);
  } catch {
    return false;
  }
}

export function getVoiceCapability(): VoiceCapability {
  const nativeVoice = hasNativeVoiceModule();
  const webRecognition = hasWebSpeechRecognition();
  const webTts = hasWebSpeechSynthesis();
  const expoTts = hasExpoSpeech();
  const elevenConfigured = isElevenLabsConfigured();
  const elevenPlayback = hasNativeElevenPlayback();
  const elevenReady = elevenConfigured && elevenPlayback;
  const notes: string[] = [];

  if (Platform.OS === 'web') {
    notes.push('Web is a test harness; browser speech APIs may stop after no-speech and may restrict audio output.');
    if (!webRecognition) notes.push('Browser SpeechRecognition/webkitSpeechRecognition is unavailable.');
    if (!elevenReady && !webTts && !expoTts) notes.push('No web, ElevenLabs, or expo-speech TTS provider is available.');
  } else {
    if (!nativeVoice) notes.push('@react-native-voice/voice native module is missing; rebuild the dev client/APK.');
    if (!elevenConfigured) notes.push('ElevenLabs is not configured; local/tool replies will fall back to robotic OS voices.');
    if (elevenConfigured && !elevenPlayback) notes.push('Install/rebuild expo-av and expo-file-system so ElevenLabs audio can play on Android.');
    if (!expoTts) notes.push('expo-speech fallback is missing; emergency offline speech will be unavailable.');
  }

  return {
    platform: Platform.OS,
    speechRecognition: nativeVoice ? 'native' : webRecognition ? 'web' : 'missing',
    speechSynthesis: elevenReady ? 'elevenlabs' : webTts ? 'web' : expoTts ? 'expo-speech' : 'missing',
    expressiveTts: elevenReady,
    alwaysOnExpectation: Platform.OS === 'web' ? 'browser-limited' : nativeVoice ? 'native-build' : 'unknown',
    notes,
  };
}
