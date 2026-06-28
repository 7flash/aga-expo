# Hotfix: clear voice routing and visible state

This batch fixes the runtime symptom where short utility requests such as “what time is it” were routed into Gemini Live because `casual_by_default` treated almost everything as live conversation.

## Changed behavior

- “what time is it”, date, weather, simple utility, settings, reminders, and YouTube requests stay on the short answer/tool path.
- Open-ended conversation requests like “let’s talk” still open live transport.
- Direct time/weather shortcuts answer deterministically through `capabilityRunner`, then speak via the normal short TTS path.
- Short GPT/tool turns now write both user and assistant messages, so the UI has an assistant plate/reply instead of only repeated user bubbles.
- The web wake overlay now shows phase + reason, last heard text, and last AGA reply.
- Live transport startup status names the actual selected transport, such as Gemini Live or ElevenLabs Agent.

## Files

```txt
src/aga/WakeRealtimeController.ts
src/aga/shortReasoningTurn.ts
src/voice/voicePathPolicy.ts
src/voice/liveEscalation.ts
src/voice/wakeDebugBus.ts
docs/VOICE_PIPELINE.md
scripts/aga-validate-changed-files.js
```

## Validation

```txt
OK scripts/aga-validate-changed-files.js
OK src/aga/WakeRealtimeController.ts
OK src/aga/shortReasoningTurn.ts
OK src/voice/liveEscalation.ts
OK src/voice/voicePathPolicy.ts
OK src/voice/wakeDebugBus.ts
[aga:validate] checked 6 file(s), 0 syntax errors
```
