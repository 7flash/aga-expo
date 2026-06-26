import AVFoundation
import ExpoModulesCore

public class AgaNativeAudioModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AgaNativeAudio")

    AsyncFunction("enterVoiceChatMode") { (options: [String: Any]?) -> [String: Any] in
      let session = AVAudioSession.sharedInstance()
      var opts: AVAudioSession.CategoryOptions = [.defaultToSpeaker, .allowBluetooth]
      if #available(iOS 10.0, *) { opts.insert(.allowBluetoothA2DP) }
      try session.setCategory(.playAndRecord, mode: .voiceChat, options: opts)
      try session.setPreferredSampleRate(16000)
      try session.setPreferredIOBufferDuration(0.02)
      try session.setActive(true, options: [])
      return [
        "ok": true,
        "platform": "ios",
        "mode": "AVAudioSessionModeVoiceChat",
        "category": "AVAudioSessionCategoryPlayAndRecord",
        "sampleRate": session.sampleRate,
        "ioBufferDuration": session.ioBufferDuration
      ]
    }

    AsyncFunction("exitVoiceChatMode") { () -> [String: Any] in
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playback, mode: .default, options: [.duckOthers])
      try session.setActive(false, options: [.notifyOthersOnDeactivation])
      return ["ok": true, "platform": "ios", "mode": "default"]
    }

    AsyncFunction("startWakeForegroundService") { (_: [String: Any]?) -> [String: Any] in
      // iOS background microphone lifetime is governed by UIBackgroundModes=audio
      // and an active AVAudioSession. There is no Android-style foreground service.
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
      try session.setActive(true, options: [])
      return ["ok": true, "platform": "ios", "foreground": true, "backgroundMode": "audio"]
    }

    AsyncFunction("stopWakeForegroundService") { () -> [String: Any] in
      return ["ok": true, "platform": "ios", "foreground": false]
    }

    Function("getCapabilities") { () -> [String: Any] in
      return [
        "ok": true,
        "platform": "ios",
        "voiceChatMode": true,
        "category": "playAndRecord",
        "mode": "voiceChat",
        "backgroundAudio": true,
        "coreMlRecommended": true
      ]
    }
  }
}
