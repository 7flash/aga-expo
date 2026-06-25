import { measureAsync, measureMark } from '../observability/measure';

export type RealtimeSession = {
  clientSecret: string;
  model?: string;
  expiresAt?: string;
};

function env(name: string) {
  return process.env?.[name] ?? '';
}

function extractSecret(data: any): string {
  return String(
    data?.client_secret?.value ||
    data?.client_secret ||
    data?.secret ||
    data?.ephemeral_key ||
    ''
  );
}

/**
 * Fetches an ephemeral Realtime session from the user's backend.
 * This keeps permanent provider keys out of the APK/browser bundle.
 */
export async function createRealtimeSession(): Promise<RealtimeSession | null> {
  return measureAsync('realtime.session.create', async () => {
    const endpoint = env('EXPO_PUBLIC_AGA_REALTIME_SESSION_URL');
    if (!endpoint) return null;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: 'AGA', purpose: 'guardian_voice' }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      measureMark('realtime.session.error', { status: response.status, message: data?.error?.message || data?.message || 'session failed' });
      return null;
    }

    const clientSecret = extractSecret(data);
    if (!clientSecret) return null;
    return {
      clientSecret,
      model: data?.model,
      expiresAt: data?.expires_at || data?.expiresAt,
    };
  });
}
