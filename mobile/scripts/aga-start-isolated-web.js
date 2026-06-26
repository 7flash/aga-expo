#!/usr/bin/env node
/**
 * Start Expo Web behind a local cross-origin-isolation proxy.
 *
 * Why:
 * Sherpa's generated WASM KWS runtime uses workers + SharedArrayBuffer.
 * Browsers require the *top-level document* to be crossOriginIsolated.
 * Metro middleware may not reliably apply headers to Expo's top-level web shell,
 * so this proxy injects the headers on every response.
 *
 * Usage:
 *   node scripts/aga-start-isolated-web.js
 *   node scripts/aga-start-isolated-web.js --no-expo
 *
 * Open:
 *   http://localhost:19006
 *
 * Env:
 *   AGA_EXPO_PORT=8081
 *   AGA_ISOLATED_WEB_PORT=19006
 */
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const args = new Set(process.argv.slice(2));
const targetPort = Number(process.env.AGA_EXPO_PORT || 8081);
const proxyPort = Number(process.env.AGA_ISOLATED_WEB_PORT || 19006);
const targetHost = process.env.AGA_EXPO_HOST || '127.0.0.1';

let expoProc = null;

function log(message) {
  console.log(`[aga:isolated-web] ${message}`);
}

function setIsolationHeaders(res) {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Origin-Agent-Cluster', '?1');
}

function startExpo() {
  if (args.has('--no-expo') || args.has('--no-start-expo')) {
    log(`not starting Expo; proxying existing server at http://${targetHost}:${targetPort}`);
    return;
  }

  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const argv = ['expo', 'start', '-c', '--web', '--port', String(targetPort)];

  log(`starting Expo: ${cmd} ${argv.join(' ')}`);
  expoProc = spawn(cmd, argv, {
    cwd: process.cwd(),
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      BROWSER: 'none',
    },
  });

  expoProc.on('exit', (code, signal) => {
    log(`Expo exited code=${code} signal=${signal}`);
  });
}

function proxyRequest(clientReq, clientRes) {
  setIsolationHeaders(clientRes);

  const headers = { ...clientReq.headers };
  headers.host = `${targetHost}:${targetPort}`;

  const options = {
    hostname: targetHost,
    port: targetPort,
    method: clientReq.method,
    path: clientReq.url,
    headers,
  };

  const upstreamReq = http.request(options, (upstreamRes) => {
    setIsolationHeaders(clientRes);

    const responseHeaders = { ...upstreamRes.headers };

    // Enforce WASM/data MIME types for generated Sherpa files.
    const url = String(clientReq.url || '');
    if (url.endsWith('.wasm')) responseHeaders['content-type'] = 'application/wasm';
    if (url.endsWith('.data')) responseHeaders['content-type'] = 'application/octet-stream';

    responseHeaders['cross-origin-opener-policy'] = 'same-origin';
    responseHeaders['cross-origin-embedder-policy'] = 'require-corp';
    responseHeaders['cross-origin-resource-policy'] = 'cross-origin';
    responseHeaders['origin-agent-cluster'] = '?1';

    // Rewrite redirects back through the proxy.
    if (responseHeaders.location) {
      responseHeaders.location = String(responseHeaders.location)
        .replace(`http://${targetHost}:${targetPort}`, `http://localhost:${proxyPort}`)
        .replace(`http://localhost:${targetPort}`, `http://localhost:${proxyPort}`);
    }

    clientRes.writeHead(upstreamRes.statusCode || 200, upstreamRes.statusMessage, responseHeaders);
    upstreamRes.pipe(clientRes);
  });

  upstreamReq.on('error', (error) => {
    setIsolationHeaders(clientRes);
    clientRes.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    clientRes.end(
      `AGA isolated web proxy could not reach Expo at http://${targetHost}:${targetPort}\n\n` +
      `${error.stack || error.message || String(error)}\n\n` +
      `If Expo is still booting, refresh in a few seconds.\n`
    );
  });

  clientReq.pipe(upstreamReq);
}

function proxyUpgrade(req, socket, head) {
  const upstream = net.connect(targetPort, targetHost, () => {
    const headers = [];
    headers.push(`${req.method} ${req.url} HTTP/${req.httpVersion}`);
    for (const [key, value] of Object.entries(req.headers)) {
      headers.push(`${key}: ${value}`);
    }
    headers.push('', '');
    upstream.write(headers.join('\r\n'));
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });

  upstream.on('error', () => {
    try { socket.destroy(); } catch {}
  });
}

function startProxy() {
  const server = http.createServer(proxyRequest);
  server.on('upgrade', proxyUpgrade);

  server.listen(proxyPort, '0.0.0.0', () => {
    log(`proxy ready: http://localhost:${proxyPort}`);
    log(`target:      http://${targetHost}:${targetPort}`);
    log('open the proxy URL, not the raw Expo URL');
    log('browser console check: crossOriginIsolated === true');
  });

  server.on('error', (error) => {
    console.error(`[aga:isolated-web] ERROR: ${error.stack || error.message || error}`);
    process.exit(1);
  });
}

process.on('SIGINT', () => {
  if (expoProc) expoProc.kill('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (expoProc) expoProc.kill('SIGTERM');
  process.exit(0);
});

startExpo();
startProxy();
