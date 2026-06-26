// AGA Metro config
// Ensures Sherpa-ONNX model assets are treated as bundled assets in native builds.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const assetExts = new Set(config.resolver.assetExts || []);
for (const ext of ['onnx', 'model', 'txt', 'bin', 'wasm']) {
  assetExts.add(ext);
}

config.resolver.assetExts = Array.from(assetExts);

module.exports = config;
