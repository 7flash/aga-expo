import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'AGA Voice Assistant',
  slug: 'aga-voice-assistant',
  scheme: 'aga',
  version: '3.0.0',
  orientation: 'default',
  userInterfaceStyle: 'dark',
  android: {
    package: process.env.EXPO_ANDROID_PACKAGE ?? 'com.geeksy.aga',
    permissions: [
      'INTERNET',
      'RECORD_AUDIO',
      'MODIFY_AUDIO_SETTINGS',
      'WAKE_LOCK',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_MICROPHONE',
      'POST_NOTIFICATIONS',
    ],
    usesCleartextTraffic: process.env.EXPO_PUBLIC_AGA_ALLOW_CLEARTEXT === '1',
  },
  ios: {
    supportsTablet: true,
    infoPlist: {
      NSMicrophoneUsageDescription: 'AGA listens locally for the wake word and voice commands.',
      NSSpeechRecognitionUsageDescription: 'AGA converts your speech into commands and translations after wake activation.',
    },
  },
  web: {
    bundler: 'metro',
  },
  extra: {
    assistantWebUrl: process.env.EXPO_PUBLIC_ASSISTANT_WEB_URL ?? 'http://localhost:3000',
    wakeWord: process.env.EXPO_PUBLIC_AGA_WAKE_WORD ?? 'aga',
    displayMode: process.env.EXPO_PUBLIC_AGA_DISPLAY_MODE ?? 'tactile_relic',
    visualEngine: process.env.EXPO_PUBLIC_AGA_VISUAL_ENGINE ?? 'relic_gl',
    pureDisplay: process.env.EXPO_PUBLIC_AGA_PURE_DISPLAY ?? '1',
    edgeWake: process.env.EXPO_PUBLIC_AGA_EDGE_WAKE ?? 'optional_native',
  },
};

export default config;
