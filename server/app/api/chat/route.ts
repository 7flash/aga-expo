import { z } from 'sqlite-zod-orm';
import {
  createConversation,
  getConversation,
  listMessages,
  saveMessage,
} from '../../../src/db';
import { askAssistant } from '../../../src/openai';

const chatRequestSchema = z.object({
  conversationId: z.number().int().positive().optional().nullable(),
  message: z.string().trim().min(1).max(8_000),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = chatRequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid chat request.' },
      { status: 400 }
    );
  }

  try {
    const conversation = parsed.data.conversationId
      ? getConversation(parsed.data.conversationId)
      : createConversation(parsed.data.message.slice(0, 56));

    if (!conversation) {
      return Response.json({ error: 'Conversation not found.' }, { status: 404 });
    }

    const conversationId = Number(conversation.id);

    saveMessage({
      conversationId,
      role: 'user',
      content: parsed.data.message,
    });

    const history = listMessages(conversationId).map((message) => ({
      role: message.role,
      content: message.content,
    }));

    const reply = await askAssistant(history);

    saveMessage({
      conversationId,
      role: 'assistant',
      content: reply,
    });

    return Response.json({ conversationId, reply });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Assistant request failed.' },
      { status: 500 }
    );
  }
}
