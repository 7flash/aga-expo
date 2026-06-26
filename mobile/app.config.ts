import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'AGA Voice Assistant',
  slug: 'aga-voice-assistant',
  scheme: 'aga',
  version: '3.2.0',
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
    usesCleartextTraffic: true,
  },
  ios: {
    supportsTablet: true,
    infoPlist: {
      NSMicrophoneUsageDescription: 'AGA listens locally for its wake and safety control words.',
      UIBackgroundModes: ['audio', 'processing'],
    },
  },
  web: {
    bundler: 'metro',
  },
  plugins: ['./plugins/withAgaAudioAppliance'],
  extra: {
    assistantWebUrl: process.env.EXPO_PUBLIC_ASSISTANT_WEB_URL ?? 'http://localhost:3000',
    wakeWord: process.env.EXPO_PUBLIC_AGA_WAKE_WORD ?? 'aga',
    wakeEngine: process.env.EXPO_PUBLIC_AGA_WAKE_ENGINE ?? 'porcupine',
    displayMode: process.env.EXPO_PUBLIC_AGA_DISPLAY_MODE ?? 'tactile_relic',
  },
};

export default config;
