import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'AGA Voice Assistant',
  slug: 'aga-voice-assistant',
  scheme: 'aga',
  version: '3.3.0',
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
    bundleIdentifier: process.env.EXPO_IOS_BUNDLE_IDENTIFIER ?? 'com.geeksy.aga',
    supportsTablet: true,
    infoPlist: {
      NSMicrophoneUsageDescription: 'AGA listens locally for its wake and safety control words.',
      NSSpeechRecognitionUsageDescription: 'AGA converts your speech into commands.',
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
    wakeEngine: process.env.EXPO_PUBLIC_AGA_KEYWORD_ENGINE ?? process.env.EXPO_PUBLIC_AGA_WAKE_ENGINE ?? 'sherpa',
    displayMode: process.env.EXPO_PUBLIC_AGA_DISPLAY_MODE ?? 'true_hologram',
    eas: {
      projectId: 'b20cd053-234f-474b-8e23-22fa961a6d59',
    },
  },
};

export default config;