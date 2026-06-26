Pod::Spec.new do |s|
  s.name           = 'AgaNativeAudio'
  s.version        = '0.1.0'
  s.summary        = 'AGA native audio session and wake foreground helpers'
  s.description    = 'Configures iOS voice chat audio mode and Android foreground microphone service hooks for AGA.'
  s.author         = 'AGA'
  s.homepage       = 'https://example.invalid/aga'
  s.platforms      = { :ios => '13.0' }
  s.source         = { :path => '.' }
  s.source_files   = 'ios/**/*.{h,m,mm,swift}'
  s.dependency 'ExpoModulesCore'
  s.swift_version = '5.0'
end
