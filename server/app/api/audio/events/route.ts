import { z } from 'sqlite-zod-orm';
import { getRuntimeState, saveRuntimeState } from '../../../../src/db';
import { measured } from '../../../../src/measure';
import { createInitialAgaState, reduceAgaState } from '../../../../src/aga/stateMachine';
import { logAgaEvent } from '../../../../src/aga/eventLog';

const audioEventSchema = z.object({
  type: z.string().trim().min(1).max(80),
  payload: z.record(z.unknown()).optional().default({}),
});

const fallback = {
  agaState: createInitialAgaState(),
};

function toMachineEvent(type: string, payload: Record<string, unknown>) {
  switch (type) {
    case 'wake':
      return { type: 'wake' as const, phrase: typeof payload.phrase === 'string' ? payload.phrase : undefined };
    case 'speech_start':
      return { type: 'speech_start' as const };
    case 'speech_end':
      return { type: 'speech_end' as const, text: typeof payload.text === 'string' ? payload.text : undefined };
    case 'barge_in':
      return { type: 'barge_in' as const };
    case 'turn_start':
      return { type: 'turn_start' as const };
    case 'reply_ready':
      return { type: 'reply_ready' as const };
    case 'speech_start_output':
      return { type: 'speech_start_output' as const };
    case 'speech_done':
      return { type: 'speech_done' as const };
    case 'translate_start':
      return { type: 'translate_start' as const };
    case 'translate_stop':
      return { type: 'translate_stop' as const };
    case 'media_start':
      return { type: 'media_start' as const };
    case 'media_stop':
      return { type: 'media_stop' as const };
    case 'offline':
      return { type: 'offline' as const };
    case 'online':
      return { type: 'online' as const };
    case 'cancel':
      return { type: 'cancel' as const };
    case 'timeout':
      return { type: 'timeout' as const };
    default:
      return { type: 'recover' as const, reason: `unknown audio event: ${type}` };
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = audioEventSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid audio event.' }, { status: 400 });
  }

  return measured('audio.event', async () => {
    const runtime = getRuntimeState(fallback);
    const current = runtime.agaState ?? createInitialAgaState();
    const next = reduceAgaState(current as any, toMachineEvent(parsed.data.type, parsed.data.payload));
    const state = saveRuntimeState({ ...runtime, agaState: next, mode: next.mode });
    logAgaEvent('audio.event', { type: parsed.data.type, mode: next.mode, payload: parsed.data.payload });
    return Response.json({ ok: true, state });
  });
}
