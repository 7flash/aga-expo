import { z } from 'sqlite-zod-orm';
import { runAgentTask } from '../../../../src/agent';

const agentRequestSchema = z.object({
  goal: z.string().trim().min(1).max(2_000),
  context: z.array(z.string().max(2_000)).max(20).optional().default([]),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = agentRequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid agent request.' }, { status: 400 });
  }

  try {
    const output = await runAgentTask(parsed.data.goal, parsed.data.context);
    return Response.json(output);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Agent task failed.' },
      { status: 500 }
    );
  }
}
