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
      'POST_NOTIFICATIONS',
    ],
    usesCleartextTraffic: true,
  },
  ios: {
    supportsTablet: true,
    infoPlist: {
      NSMicrophoneUsageDescription: 'AGA listens for your wake word and voice commands.',
      NSSpeechRecognitionUsageDescription: 'AGA converts your speech into commands and translations.',
    },
  },
  web: {
    bundler: 'metro',
  },
  extra: {
    assistantWebUrl: process.env.EXPO_PUBLIC_ASSISTANT_WEB_URL ?? 'http://localhost:3000',
    wakeWord: process.env.EXPO_PUBLIC_AGA_WAKE_WORD ?? 'aga',
  },
};

export default config;
