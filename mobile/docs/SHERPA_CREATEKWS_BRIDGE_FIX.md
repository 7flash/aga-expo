# Sherpa browser `createKws` bridge fix

The browser runtime files are now building and serving. The remaining problem was
that AGA expected a fictional high-level function such as `startSherpaKws()`.

Sherpa's generated browser KWS helper actually exposes:

```js
createKws(Module, config)
```

The runtime flow is:

1. Create a global Emscripten `Module` with `locateFile`.
2. Load `sherpa-onnx-wasm-kws-main.js`.
3. Wait for `Module.onRuntimeInitialized`.
4. Load `sherpa-onnx-kws.js`.
5. Call `createKws(Module, config)`.
6. Use WebAudio frames:
   - `stream.acceptWaveform(sampleRate, samples)`
   - `recognizer.decode(stream)`
   - `recognizer.getResult(stream)`

## Check

```bash
node scripts/aga-sherpa-wasm-runtime-contract-check.js
node scripts/aga-sherpa-wasm-api-check.js
npx expo start -c --web
```

Then in the browser console:

```js
await window.__AGA_SHERPA_DIAG()
```
