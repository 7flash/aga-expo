export const REQUIRED_EXPO_INSTALLS = [
  'expo-sqlite',
  'expo-speech',
  'expo-av',
  'react-native-webview',
  'expo-notifications',
  'expo-clipboard',
  'expo-file-system',
  'expo-sharing',
  'expo-secure-store',
];

export const REQUIRED_NPM_INSTALLS = ['@react-native-voice/voice'];

export const OPTIONAL_EXPRESSIVE_VOICE_INSTALLS = [
  '@elevenlabs/react-native',
  '@livekit/react-native',
  '@livekit/react-native-webrtc',
  'livekit-client',
];

export const BUILD_COMMANDS = [
  'npx expo install expo-sqlite expo-speech expo-av react-native-webview expo-notifications expo-clipboard expo-file-system expo-sharing expo-secure-store',
  'npm install @react-native-voice/voice',
  'npx expo start --clear',
  'npx expo prebuild',
  'npx expo run:android',
];

export const ELEVENLABS_SDK_COMMANDS = [
  'npm install @elevenlabs/react-native @livekit/react-native @livekit/react-native-webrtc livekit-client',
  'npx expo prebuild',
  'npx expo run:android',
];

export const RELEASE_COMMANDS = [
  'node scripts/aga-voice-check.js',
  'npm run lint --if-present',
  'npm run typecheck --if-present',
  'npx expo-doctor',
  'npx eas build --platform android --profile preview',
  'npx eas build --platform android --profile production',
];

export function dependencySpeech() {
  return `Required Expo modules: ${REQUIRED_EXPO_INSTALLS.join(', ')}. Required npm module: ${REQUIRED_NPM_INSTALLS.join(', ')}. Build path: install dependencies, clear start, prebuild, then run Android. ElevenLabs raw TTS needs EXPO_PUBLIC_ELEVENLABS_API_KEY and EXPO_PUBLIC_ELEVENLABS_VOICE_ID.`;
}

export function elevenLabsSdkSpeech() {
  return `Optional full ElevenLabs conversational SDK path: ${ELEVENLABS_SDK_COMMANDS.join('; ')}. Use this later only if you want ElevenLabs to own VAD, STT, LLM routing, and TTS as a separate transport.`;
}

export function releaseCommandSpeech() {
  return `Release commands: ${RELEASE_COMMANDS.join('; ')}.`;
}

export function buildCommandSpeech() {
  return `Build commands: ${BUILD_COMMANDS.join('; ')}.`;
}
