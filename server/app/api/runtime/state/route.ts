import { z } from 'sqlite-zod-orm';
import { getRuntimeState, saveRuntimeState } from '../../../../src/db';
import { measured } from '../../../../src/measure';

const runtimeSchema = z.object({
  state: z.record(z.unknown()).default({}),
});

const fallback = {
  mode: 'idle',
  lastMediaProvider: null,
  lastMediaTitle: null,
  lastTranslationTarget: 'English',
  lastRecovery: null,
};

export async function GET() {
  return Response.json({ state: getRuntimeState(fallback) });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = runtimeSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid runtime state.' }, { status: 400 });
  }

  return measured('runtime.state.patch', async () => {
    const next = saveRuntimeState({ ...getRuntimeState(fallback), ...parsed.data.state });
    return Response.json({ state: next });
  });
}
