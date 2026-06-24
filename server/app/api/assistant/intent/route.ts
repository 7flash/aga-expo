import { z } from 'sqlite-zod-orm';
import { classifyIntent } from '../../../../src/intent';
import { saveCommandEvent } from '../../../../src/db';
import { measured } from '../../../../src/measure';

const intentRequestSchema = z.object({
  command: z.string().trim().min(1).max(2_000),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = intentRequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid intent request.' }, { status: 400 });
  }

  return measured('intent.classify', async () => {
    const intent = classifyIntent(parsed.data.command);
    saveCommandEvent('intent.classified', intent);
    return Response.json({ intent });
  });
}
