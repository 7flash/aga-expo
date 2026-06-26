#!/usr/bin/env node
/**
 * Checks that the isolated proxy is serving COOP/COEP headers.
 */
const http = require('http');

const port = Number(process.env.AGA_ISOLATED_WEB_PORT || 19006);

function fail(message) {
  console.error(`[aga:isolated-web-check] ERROR: ${message}`);
  process.exit(1);
}

http.get(`http://localhost:${port}`, (res) => {
  const h = res.headers;
  const coop = h['cross-origin-opener-policy'];
  const coep = h['cross-origin-embedder-policy'];
  const corp = h['cross-origin-resource-policy'];

  if (coop !== 'same-origin') fail(`missing/invalid COOP header: ${coop}`);
  if (coep !== 'require-corp') fail(`missing/invalid COEP header: ${coep}`);
  if (corp !== 'cross-origin') fail(`missing/invalid CORP header: ${corp}`);

  console.log('[aga:isolated-web-check] ok', JSON.stringify({
    url: `http://localhost:${port}`,
    coop,
    coep,
    corp,
  }, null, 2));

  res.resume();
}).on('error', (error) => {
  fail(`could not reach isolated proxy on port ${port}: ${error.message || error}`);
});
