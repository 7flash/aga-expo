# Web cross-origin isolation for Sherpa WASM

The browser error:

```text
DataCloneError: Failed to execute 'postMessage' on 'Worker':
SharedArrayBuffer transfer requires self.crossOriginIsolated.
```

means Sherpa's generated WASM runtime is now loading, but the page is not
cross-origin isolated.

The fix is to serve Expo Web with these headers:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: cross-origin
Origin-Agent-Cluster: ?1
```

This patch adds those headers in `metro.config.js` via Metro's
`server.enhanceMiddleware`.

## Run

Restart Expo completely after applying this patch:

```bash
node scripts/aga-web-isolation-check.js
npx expo start -c --web
```

Then open the browser console:

```js
crossOriginIsolated
await window.__AGA_SHERPA_DIAG()
```

Expected:

```js
crossOriginIsolated === true
```

If it remains false, close all old Expo tabs and restart the dev server again.
The headers only apply after a full dev server restart.
