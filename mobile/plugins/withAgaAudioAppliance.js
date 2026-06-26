const { AndroidConfig, withAndroidManifest, withInfoPlist, createRunOncePlugin } = require('@expo/config-plugins');

const pkg = require('../package.json');

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureAndroidPermission(manifest, name) {
  manifest.manifest['uses-permission'] = ensureArray(manifest.manifest['uses-permission']);
  if (!manifest.manifest['uses-permission'].some((p) => p?.$?.['android:name'] === name)) {
    manifest.manifest['uses-permission'].push({ $: { 'android:name': name } });
  }
}

function ensureService(mainApplication, service) {
  mainApplication.service = ensureArray(mainApplication.service);
  const existing = mainApplication.service.find((s) => s?.$?.['android:name'] === service.$['android:name']);
  if (existing) Object.assign(existing.$, service.$);
  else mainApplication.service.push(service);
}

function withAgaAudioAppliance(config) {
  config = withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults;
    ensureAndroidPermission(manifest, 'android.permission.RECORD_AUDIO');
    ensureAndroidPermission(manifest, 'android.permission.MODIFY_AUDIO_SETTINGS');
    ensureAndroidPermission(manifest, 'android.permission.WAKE_LOCK');
    ensureAndroidPermission(manifest, 'android.permission.FOREGROUND_SERVICE');
    ensureAndroidPermission(manifest, 'android.permission.FOREGROUND_SERVICE_MICROPHONE');
    ensureAndroidPermission(manifest, 'android.permission.POST_NOTIFICATIONS');

    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    ensureService(app, {
      $: {
        'android:name': 'com.geeksy.aga.audio.AgaWakeForegroundService',
        'android:exported': 'false',
        'android:foregroundServiceType': 'microphone',
        'android:stopWithTask': 'false',
      },
    });
    return mod;
  });

  config = withInfoPlist(config, (mod) => {
    const plist = mod.modResults;
    const modes = new Set([...(plist.UIBackgroundModes || []), 'audio', 'processing']);
    plist.UIBackgroundModes = Array.from(modes);
    plist.NSMicrophoneUsageDescription = plist.NSMicrophoneUsageDescription || 'AGA listens locally for wake and safety control words.';
    plist.NSLocalNetworkUsageDescription = plist.NSLocalNetworkUsageDescription || 'AGA may connect to a local companion or voice service on your network.';
    return mod;
  });
  return config;
}

module.exports = createRunOncePlugin(withAgaAudioAppliance, 'with-aga-audio-appliance', pkg.version || '1.0.0');
