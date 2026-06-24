export const REQUIRED_EXPO_INSTALLS = [
  'expo-sqlite',
  'expo-speech',
  'react-native-webview',
  'expo-notifications',
  'expo-clipboard',
  'expo-file-system',
  'expo-sharing',
  'expo-secure-store',
];

export const REQUIRED_NPM_INSTALLS = ['@react-native-voice/voice'];

export const BUILD_COMMANDS = [
  'npx expo install expo-sqlite expo-speech react-native-webview expo-notifications expo-clipboard expo-file-system expo-sharing expo-secure-store',
  'npm install @react-native-voice/voice',
  'npx expo start --clear',
  'npx expo prebuild',
  'npx expo run:android',
];

export const RELEASE_COMMANDS = [
  'npm run lint --if-present',
  'npm run typecheck --if-present',
  'npx expo-doctor',
  'npx eas build --platform android --profile preview',
  'npx eas build --platform android --profile production',
];

export function dependencySpeech() {
  return `Required Expo modules: ${REQUIRED_EXPO_INSTALLS.join(', ')}. Required npm module: ${REQUIRED_NPM_INSTALLS.join(', ')}. Build path: install dependencies, clear start, prebuild, then run Android.`;
}

export function releaseCommandSpeech() {
  return `Release commands: ${RELEASE_COMMANDS.join('; ')}.`;
}

export function buildCommandSpeech() {
  return `Build commands: ${BUILD_COMMANDS.join('; ')}.`;
}
