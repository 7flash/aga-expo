import {
  assistantPreferencesSchema,
  getAssistantPreferences,
  saveAssistantPreferences,
} from '../../../src/db';
import { measured } from '../../../src/measure';

const patchSchema = assistantPreferencesSchema.partial();

export async function GET() {
  return Response.json({ preferences: getAssistantPreferences() });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid preferences.' },
      { status: 400 }
    );
  }

  return measured('preferences.patch', async () => {
    const preferences = saveAssistantPreferences(parsed.data);
    return Response.json({ preferences });
  });
}
