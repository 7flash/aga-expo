export const REQUIRED_EXPO_INSTALLS = [
  'expo-sqlite',
  'expo-av',
  'expo-file-system',
  'expo-notifications',
  'expo-clipboard',
  'expo-sharing',
  'expo-secure-store',
  'react-native-webview',
];

export const REQUIRED_NPM_INSTALLS = [
  '@picovoice/porcupine-react-native',
];

export const BUILD_COMMANDS = [
  'npx expo install expo-sqlite expo-av expo-file-system expo-notifications expo-clipboard expo-sharing expo-secure-store react-native-webview',
  'npm install @picovoice/porcupine-react-native',
  'npx expo start --clear',
  'npx expo prebuild',
  'npx expo run:android',
];

export const RELEASE_COMMANDS = [
  'npm run aga:appliance-check --if-present',
  'npm run aga:voice-check --if-present',
  'npm run lint --if-present',
  'npm run typecheck --if-present',
  'npx expo-doctor',
  'npx eas build --platform android --profile preview',
  'npx eas build --platform android --profile production',
];

export function dependencySpeech() {
  return `Required Expo modules: ${REQUIRED_EXPO_INSTALLS.join(', ')}. Required npm modules: ${REQUIRED_NPM_INSTALLS.join(', ')}. Build path: install dependencies, clear start, prebuild, then run Android.`;
}

export function releaseCommandSpeech() {
  return `Release commands: ${RELEASE_COMMANDS.join('; ')}.`;
}

export function buildCommandSpeech() {
  return `Build commands: ${BUILD_COMMANDS.join('; ')}.`;
}
