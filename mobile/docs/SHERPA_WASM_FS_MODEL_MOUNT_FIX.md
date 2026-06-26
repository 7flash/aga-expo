# Sherpa WASM FS model mount fix

The app reached this state:

```text
[aga:sherpa-wasm] creating sherpa kws recognizer
Validate tokens: '/sherpa/kws-model/tokens.txt' does not exist
```

That means the browser runtime is now loading and the microphone is opening.
The remaining issue is path semantics.

Sherpa's generated `createKws(Module, config)` expects model paths inside the
Emscripten virtual filesystem. Browser URL paths such as:

```text
/sherpa/kws-model/tokens.txt
```

are not valid files from the WASM runtime's point of view.

This patch:

1. fetches the browser-served assets from `/sherpa/kws-model`
2. writes them into the Emscripten FS under `/aga-kws-model`
3. passes `/aga-kws-model/...` paths to `createKws`

## Check

```bash
node scripts/aga-sherpa-wasm-fs-mount-check.js
node scripts/aga-sherpa-wasm-api-check.js
node scripts/aga-sherpa-wasm-runtime-contract-check.js
node scripts/aga-start-isolated-web.js
```

Open:

```text
http://localhost:19006
```

Expected logs:

```text
loading sherpa wasm module
loading sherpa createKws bridge
mounting kws model assets into wasm fs
creating sherpa kws recognizer
requesting microphone
listening
```
