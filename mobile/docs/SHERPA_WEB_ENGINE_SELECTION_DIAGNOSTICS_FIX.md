# Sherpa web engine selection diagnostics fix

The UI still said:

```text
Sherpa web runtime missing
```

after the runtime files were built. That means the active wake engine was still using
an old web-Sherpa path, not the `createKws` browser bridge.

This patch replaces `src/voice/wakeEngine.ts` with an explicit selector:

```text
web    -> SherpaWasmKeywordEngine
native -> Sherpa native placeholder/adapter
```

It also logs the exact Sherpa startup stage:

```text
loading sherpa wasm module
loading sherpa createKws bridge
creating sherpa kws recognizer
requesting microphone
listening
```

## Check

```bash
node scripts/aga-wake-engine-selection-check.js
node scripts/aga-sherpa-wasm-runtime-contract-check.js
node scripts/aga-sherpa-wasm-api-check.js
npx expo start -c --web
```

If it still fails, the console should now include the exact thrown error instead of
only the truncated UI label.
