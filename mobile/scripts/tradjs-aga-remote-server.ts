/**
 * Minimal TradJS/Node remote config server adapter for AGA.
 *
 * The device works without this server because src/remote/localConfig.json is bundled.
 * When this server is reachable, its response overlays the bundled local config.
 *
 * Wire these handlers into TradJS routes, or run the small standalone server below:
 *   AGA_CONFIG_PORT=8787 node scripts/tradjs-aga-remote-server.js
 */

type Json = Record<string, unknown>;

const revision = process.env.AGA_CONFIG_REVISION || `server-${new Date().toISOString().slice(0, 10)}`;

export function buildAgaConfig(query: Json = {}) {
  const deviceLabel = String(query.deviceLabel || process.env.AGA_DEVICE_LABEL || 'AGA TradJS device');
  return {
    schemaVersion: 1,
    revision,
    deviceLabel,
    pollMs: Number(process.env.AGA_CONFIG_POLL_MS || 60_000),
    labels: {
      brand: 'AGA',
      wakeHint: 'Say AGA',
      serverState: 'TradJS config active',
    },
    images: {
      guardianAura: '/assets/aga/guardian-aura.png',
      skillLanguage: '/assets/aga/skill-language.png',
      skillImagination: '/assets/aga/skill-imagination.png',
    },
    settings: {
      realtimeVoice: process.env.AGA_REALTIME_VOICE || 'marin',
      realtimeListenMode: process.env.AGA_LISTEN_MODE || 'strict',
      allowBargeIn: process.env.AGA_ALLOW_BARGE_IN === '1',
      mediaDuckingEnabled: true,
    },
    realtime: {
      model: process.env.AGA_REALTIME_MODEL || 'gpt-realtime-2',
      voice: process.env.AGA_REALTIME_VOICE || 'marin',
      listenMode: process.env.AGA_LISTEN_MODE || 'strict',
      allowBargeIn: process.env.AGA_ALLOW_BARGE_IN === '1',
      instructions:
        'You are AGA controlled by TradJS server config. Use server skills when relevant, but continue working locally if the server disappears.',
    },
    skills: [
      {
        id: 'tradjs_language_tutor',
        label: 'TradJS language tutor',
        description: 'Server-editable language tutor skill.',
        aliases: ['language tutor', 'server language', 'practice language'],
        kind: 'language',
        targetLanguage: 'English',
        priority: 1,
        instructions:
          'Run a friendly language tutoring session. Ask the user what topic they want, correct one mistake at a time, and offer numbered practice options.',
      },
      {
        id: 'tradjs_imagination_world',
        label: 'TradJS imagination world',
        description: 'Server-editable imagination game.',
        aliases: ['server game', 'imagination world', 'adventure'],
        kind: 'imagination',
        theme: process.env.AGA_IMAGINATION_THEME || 'floating crystal city',
        priority: 2,
        instructions:
          'Run a voice-only imagination game in a floating crystal city. Narrate one short scene and offer exactly three numbered choices.',
      },
    ],
    tools: [
      {
        name: 'tradjs_note',
        description: 'Send a short note/event to the TradJS backend for custom automation.',
        endpoint: process.env.AGA_TOOL_ENDPOINT || '/aga/tools',
        timeoutMs: 8000,
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            kind: { type: 'string' },
          },
          required: ['text'],
        },
      },
    ],
    observability: {
      endpoint: process.env.AGA_OBSERVABILITY_ENDPOINT || '/aga/observability',
      sampleRate: Number(process.env.AGA_OBSERVABILITY_SAMPLE_RATE || 0.5),
    },
    updates: {
      ota: process.env.AGA_OTA_POLICY || 'check',
      apkVersion: process.env.AGA_APK_VERSION || undefined,
      apkUrl: process.env.AGA_APK_URL || undefined,
      nativeUpdateRequired: process.env.AGA_NATIVE_UPDATE_REQUIRED === '1',
      message: process.env.AGA_UPDATE_MESSAGE || undefined,
    },
  };
}

export async function handleAgaConfigRequest(request: Request) {
  const url = new URL(request.url);
  return json(buildAgaConfig(Object.fromEntries(url.searchParams.entries())));
}

export async function handleAgaToolRequest(request: Request) {
  const body = await request.json().catch(() => ({}));
  const tool = String(body?.tool || 'unknown');
  const args = body?.args || {};
  console.log('[aga tool]', tool, args);
  if (tool === 'tradjs_note') {
    return json({ ok: true, output: `TradJS received note: ${String(args?.text || '').slice(0, 160)}` });
  }
  return json({ ok: false, error: { message: `Unknown server tool: ${tool}` } }, 404);
}

export async function handleAgaObservationRequest(request: Request) {
  const body = await request.json().catch(() => ({}));
  console.log('[aga observation]', JSON.stringify(body).slice(0, 2000));
  return json({ ok: true });
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization',
    },
  });
}

export async function routeAgaRemoteRequest(request: Request) {
  if (request.method === 'OPTIONS') return json({ ok: true });
  const path = new URL(request.url).pathname;
  if (path.endsWith('/aga/config')) return handleAgaConfigRequest(request);
  if (path.endsWith('/aga/tools')) return handleAgaToolRequest(request);
  if (path.endsWith('/aga/observability')) return handleAgaObservationRequest(request);
  return json({ ok: false, error: { message: 'Not found' } }, 404);
}

// Tiny standalone fallback for Bun/modern Node. TradJS can import routeAgaRemoteRequest instead.
const g: any = globalThis as any;
if (typeof g.Bun !== 'undefined' && import.meta && (import.meta as any).main) {
  const port = Number(process.env.AGA_CONFIG_PORT || 8787);
  g.Bun.serve({ port, fetch: routeAgaRemoteRequest });
  console.log(`AGA TradJS config server listening on http://localhost:${port}/aga/config`);
}
