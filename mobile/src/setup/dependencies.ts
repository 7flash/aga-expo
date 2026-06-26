export const REQUIRED_EXPO_INSTALLS = [
  'expo-av',
  'expo-file-system',
  'expo-secure-store',
  'expo-sqlite',
  'expo-keep-awake',
];

export const REQUIRED_NPM_INSTALLS = [
  'react-native-sherpa-onnx',
];

export const OPTIONAL_BROWSER_INSTALLS = [
  'sherpa-onnx-wasm',
  'sherpa-onnx-web',
];

export const OPTIONAL_WAKE_FALLBACK_INSTALLS = [
  '@picovoice/porcupine-react-native',
  '@picovoice/porcupine-web',
];

export const OPTIONAL_AUDIO_CAPTURE_INSTALLS = [
  'react-native-audio-record',
];

export const BUILD_COMMANDS = [
  'npx expo install expo-av expo-file-system expo-secure-store expo-sqlite expo-keep-awake',
  'npm install react-native-sherpa-onnx',
  'npm install sherpa-onnx-wasm --save-dev',
  'npx expo start --clear',
  'npx expo prebuild',
  'npx expo run:android',
];

export const RELEASE_COMMANDS = [
  'npm run aga:sherpa-routing-check --if-present',
  'npm run aga:appliance-check --if-present',
  'npm run aga:voice-check --if-present',
  'npm run lint --if-present',
  'npm run typecheck --if-present',
  'npx expo-doctor',
  'npx eas build --platform android --profile preview',
  'npx eas build --platform android --profile production',
];

export function dependencySpeech() {
  return `Required Expo modules: ${REQUIRED_EXPO_INSTALLS.join(', ')}. Required npm modules: ${REQUIRED_NPM_INSTALLS.join(', ')}. Browser Sherpa WASM is optional but recommended for preview. Porcupine is now only a fallback for fixed wake words.`;
}

export function releaseCommandSpeech() {
  return `Release commands: ${RELEASE_COMMANDS.join('; ')}.`;
}

export function buildCommandSpeech() {
  return `Build commands: ${BUILD_COMMANDS.join('; ')}.`;
}
