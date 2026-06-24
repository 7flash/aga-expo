import { z } from 'sqlite-zod-orm';
import { saveCommandEvent } from '../../../../src/db';
import { measured } from '../../../../src/measure';

const eventSchema = z.object({
  kind: z.string().trim().min(1).max(80),
  payload: z.unknown().optional(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = eventSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid event.' }, { status: 400 });
  }

  return measured('voice.event', async () => {
    saveCommandEvent(parsed.data.kind, parsed.data.payload ?? {});
    return Response.json({ ok: true });
  });
}
