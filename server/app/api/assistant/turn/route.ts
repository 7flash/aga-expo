import { z } from 'sqlite-zod-orm';
import {
  createConversation,
  getConversation,
  listMessages,
  saveCommandEvent,
  saveMessage,
} from '../../../../src/db';
import { buildAssistantTurn } from '../../../../src/aga/assistantTurn';
import { logAgaError, logAgaEvent } from '../../../../src/aga/eventLog';
import { measured } from '../../../../src/measure';

const turnRequestSchema = z.object({
  conversationId: z.number().int().positive().optional().nullable(),
  message: z.string().trim().min(1).max(8_000),
  allowModelActions: z.boolean().optional().default(true),
  clientState: z.record(z.unknown()).optional().default({}),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = turnRequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid turn request.' }, { status: 400 });
  }

  return measured('assistant.turn', async () => {
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

      const turn = await buildAssistantTurn({
        command: parsed.data.message,
        history,
        allowModelActions: parsed.data.allowModelActions,
      });

      if (turn.speech.trim()) {
        saveMessage({
          conversationId,
          role: 'assistant',
          content: turn.speech,
        });
      }

      saveCommandEvent('assistant.turn.completed', {
        conversationId,
        intent: turn.intent.name,
        actionTypes: turn.actions.map((action) => action.type),
        clientMode: parsed.data.clientState?.mode ?? null,
      });

      logAgaEvent('turn.completed', {
        conversationId,
        intent: turn.intent.name,
        actions: turn.actions.length,
      });

      return Response.json({ conversationId, ...turn });
    } catch (error) {
      logAgaError('turn', error);
      return Response.json(
        { error: error instanceof Error ? error.message : 'Assistant turn failed.' },
        { status: 500 }
      );
    }
  });
}
