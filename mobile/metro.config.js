const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const extraAssetExts = ['onnx', 'model', 'wasm', 'data', 'txt'];
config.resolver.assetExts = Array.from(new Set([
  ...(config.resolver.assetExts || []),
  ...extraAssetExts,
]));

const previousEnhanceMiddleware = config.server && config.server.enhanceMiddleware;

config.server = {
  ...(config.server || {}),
  enhanceMiddleware(middleware, server) {
    const upstream = previousEnhanceMiddleware
      ? previousEnhanceMiddleware(middleware, server)
      : middleware;

    return (req, res, next) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Origin-Agent-Cluster', '?1');

      const url = String(req.url || '');
      if (url.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
      if (url.endsWith('.data')) res.setHeader('Content-Type', 'application/octet-stream');

      return upstream(req, res, next);
    };
  },
};

module.exports = config;
