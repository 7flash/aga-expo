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
        "ioBufferDuration": session.ioBufferDuration,
        "inputAvailable": session.isInputAvailable,
        "currentRoute": routeSummary(session),
        "aecPolicy": "playAndRecord + voiceChat enables platform voice-processing AEC when supported"
      ]
    }

    AsyncFunction("exitVoiceChatMode") { () -> [String: Any] in
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playback, mode: .default, options: [.duckOthers])
      try session.setActive(false, options: [.notifyOthersOnDeactivation])
      return ["ok": true, "platform": "ios", "mode": "default", "currentRoute": routeSummary(session)]
    }

    AsyncFunction("startWakeForegroundService") { (_: [String: Any]?) -> [String: Any] in
      // iOS background microphone lifetime is governed by UIBackgroundModes=audio
      // and an active AVAudioSession. There is no Android-style foreground service.
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
      try session.setPreferredSampleRate(16000)
      try session.setPreferredIOBufferDuration(0.02)
      try session.setActive(true, options: [])
      return ["ok": true, "platform": "ios", "foreground": true, "backgroundMode": "audio", "currentRoute": routeSummary(session)]
    }

    AsyncFunction("refreshWakeForegroundService") { (_: [String: Any]?) -> [String: Any] in
      let session = AVAudioSession.sharedInstance()
      return ["ok": true, "platform": "ios", "foreground": session.isOtherAudioPlaying == false, "backgroundMode": "audio", "currentRoute": routeSummary(session)]
    }

    AsyncFunction("stopWakeForegroundService") { () -> [String: Any] in
      return ["ok": true, "platform": "ios", "foreground": false]
    }

    Function("getCapabilities") { () -> [String: Any] in
      let session = AVAudioSession.sharedInstance()
      return [
        "ok": true,
        "platform": "ios",
        "voiceChatMode": true,
        "category": String(describing: session.category),
        "mode": String(describing: session.mode),
        "backgroundAudio": true,
        "coreMlRecommended": true,
        "sampleRate": session.sampleRate,
        "ioBufferDuration": session.ioBufferDuration,
        "inputAvailable": session.isInputAvailable,
        "currentRoute": routeSummary(session)
      ]
    }
  }
}

private func routeSummary(_ session: AVAudioSession) -> String {
  let inputs = session.currentRoute.inputs.map { $0.portType.rawValue }.joined(separator: ",")
  let outputs = session.currentRoute.outputs.map { $0.portType.rawValue }.joined(separator: ",")
  return "in=[\(inputs)] out=[\(outputs)]"
}
