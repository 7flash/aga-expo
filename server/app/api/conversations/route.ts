import { z } from 'sqlite-zod-orm';
import { createConversation, listConversations } from '../../../src/db';

const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
});

export async function GET() {
  return Response.json({ conversations: listConversations() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = createConversationSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid conversation.' },
      { status: 400 }
    );
  }

  const conversation = createConversation(parsed.data.title ?? 'New chat');
  return Response.json({ conversation }, { status: 201 });
}
