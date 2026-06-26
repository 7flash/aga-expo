# Sherpa WASM output copy fix

The build succeeded and produced:

```text
sherpa-onnx-kws.js
sherpa-onnx-wasm-kws-main.data
sherpa-onnx-wasm-kws-main.js
sherpa-onnx-wasm-kws-main.wasm
```

Then AGA crashed with:

```text
ENOENT: no such file or directory, stat '.../scripts/go/_internal/lib/aarch64-apple-darwin'
```

That was caused by the AGA copy step recursively scanning the entire Sherpa repo.
Some generated build trees contain platform-specific missing paths/symlinks.

The fix is to copy only Sherpa's official browser install output:

```text
.aga-cache/sherpa-wasm-kws/sherpa-onnx/build-wasm-simd-kws/install/bin/wasm/
```

into:

```text
public/sherpa/runtime/kws/
```

## Run

```bash
source ~/emsdk/emsdk_env.sh
node scripts/aga-setup-sherpa-browser-all.js --force --no-start
npx expo start -c --web
```

No clean rebuild is required if the Sherpa build already completed. The script will still run the build command, but the heavy part should be incremental.
