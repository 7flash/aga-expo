# Sherpa WASM KWS asset injection fix

The observed failure:

```text
wasm/kws/assets/decoder-epoch-12-avg-2-chunk-16-left-64.onnx does not exist
Please read wasm/kws/assets/README.md before you continue
```

This is Sherpa's build script complaining, not Expo.

AGA already generated the model assets under:

```text
assets/kws-model/
```

But Sherpa's official browser KWS build expects the model files to be physically present inside the cloned Sherpa source tree:

```text
.aga-cache/sherpa-wasm-kws/sherpa-onnx/wasm/kws/assets/
```

with these exact names:

```text
encoder-epoch-12-avg-2-chunk-16-left-64.onnx
decoder-epoch-12-avg-2-chunk-16-left-64.onnx
joiner-epoch-12-avg-2-chunk-16-left-64.onnx
tokens.txt
```

This patch injects them before running `build-wasm-simd-kws.sh`.

## Run

```bash
source ~/emsdk/emsdk_env.sh
node scripts/aga-setup-sherpa-browser-all.js --force --clean --no-start
npx expo start -c --web
```

Or if Emscripten is not installed:

```bash
node scripts/aga-setup-sherpa-browser-all.js --force --install-emscripten --clean --no-start
npx expo start -c --web
```

## Manual repair command

If the Sherpa repo is already cloned and only the assets are missing:

```bash
node scripts/aga-copy-kws-assets-into-sherpa-wasm.js
```
