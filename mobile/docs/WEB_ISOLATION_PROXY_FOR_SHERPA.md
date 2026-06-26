# AGA isolated web proxy for Sherpa WASM

Sherpa's generated browser KWS runtime uses workers and `SharedArrayBuffer`.
The browser will throw:

```text
SharedArrayBuffer transfer requires self.crossOriginIsolated
```

unless the **top-level document** is served with COOP/COEP headers.

`metro.config.js` middleware is useful, but Expo Web can still serve the top-level
shell in a way that does not become isolated. The reliable local-dev fix is to open
AGA through a small proxy that injects the headers on every response.

## Run

Stop Expo first, then run:

```bash
node scripts/aga-start-isolated-web.js
```

Open:

```text
http://localhost:19006
```

Do **not** open the raw Expo URL on port 8081.

## Check

In another terminal:

```bash
node scripts/aga-isolated-web-check.js
```

In browser console:

```js
crossOriginIsolated
await window.__AGA_SHERPA_DIAG()
```

Expected:

```js
crossOriginIsolated === true
```

## Existing Expo server

If Expo is already running on port 8081:

```bash
node scripts/aga-start-isolated-web.js --no-expo
```

Then open the proxy URL:

```text
http://localhost:19006
```
