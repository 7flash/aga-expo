export const REQUIRED_EXPO_INSTALLS = [
  'expo-sqlite',
  'expo-speech',
  'react-native-webview',
  'expo-notifications',
  'expo-clipboard',
  'expo-file-system',
  'expo-sharing',
];

export const REQUIRED_NPM_INSTALLS = ['@react-native-voice/voice'];

export const BUILD_COMMANDS = [
  'npx expo install expo-sqlite expo-speech react-native-webview expo-notifications expo-clipboard expo-file-system expo-sharing',
  'npm install @react-native-voice/voice',
  'npx expo prebuild',
  'npx expo run:android',
];

export function dependencySpeech() {
  return `Required Expo modules: ${REQUIRED_EXPO_INSTALLS.join(', ')}. Required npm module: ${REQUIRED_NPM_INSTALLS.join(', ')}.`;
}
