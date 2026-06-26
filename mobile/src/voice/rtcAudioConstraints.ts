export const AGA_LIVE_RTC_AUDIO_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    sampleRate: 16000,
    sampleSize: 16,
    // Chromium/WebRTC legacy knobs. Native WebRTC stacks safely ignore unknown keys.
    googEchoCancellation: true,
    googAutoGainControl: true,
    googNoiseSuppression: true,
    googHighpassFilter: true,
  },
  video: false,
} as const;

export function liveRtcAudioConstraints() {
  return AGA_LIVE_RTC_AUDIO_CONSTRAINTS;
}
