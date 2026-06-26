import { writeLearnedSkill } from '../skills/skillRegistry';
import { upsertLearnedRoutine, upsertScenarioPattern } from '../db/localStore';

function splitTeachPhrase(text: string) {
  const clean = String(text || '').trim();
  const m = clean.match(/(?:remember|learn|teach yourself|teach you)\s+that\s+when\s+i\s+say\s+(.+?)\s*,?\s+(?:you\s+)?(?:should\s+)?(?:do|start|run|play|say)\s+(.+)/i)
    || clean.match(/when\s+i\s+say\s+(.+?)\s*,?\s+(?:do|start|run|play|say)\s+(.+)/i);
  if (!m) return null;
  return { trigger: m[1].replace(/^['"]|['"]$/g, '').trim(), action: m[2].trim() };
}

export function parseUserTaughtScenario(text: string) {
  const parsed = splitTeachPhrase(text);
  if (!parsed?.trigger || !parsed?.action) return null;
  const lower = parsed.action.toLowerCase();
  const tools: string[] = [];
  if (/breath|meditat|calm|body scan|hypnosis|conflict/.test(lower)) tools.push('start_guided_session', 'guided_session_control');
  if (/music|rain|ocean|sound|ambient/.test(lower)) tools.push('soundscape_companion', 'media_control');
  if (/remember|profile|habit/.test(lower)) tools.push('remember', 'update_user_profile');
  return {
    label: `When I say ${parsed.trigger}`,
    aliases: [parsed.trigger],
    instructions: `When the user says “${parsed.trigger}”, respond voice-first by doing this learned behavior: ${parsed.action}. Ask a brief clarifying question only if the action is unsafe or ambiguous. Keep it no-touch and short.`,
    trigger: parsed.trigger,
    action: parsed.action,
    tools: Array.from(new Set(tools)),
  };
}

export async function saveUserTaughtScenario(text: string) {
  const scenario = parseUserTaughtScenario(text);
  if (!scenario) return null;
  const skill = await writeLearnedSkill({
    label: scenario.label,
    aliases: scenario.aliases,
    instructions: scenario.instructions,
    tools: scenario.tools,
    confidence: 0.82,
  });
  await upsertScenarioPattern({
    patternKey: `taught:${scenario.trigger.toLowerCase()}`,
    label: scenario.label,
    trigger: { phrase: scenario.trigger },
    action: { learnedSkillId: skill?.id, instruction: scenario.action },
    confidence: 0.82,
    consentState: 'accepted',
  });
  await upsertLearnedRoutine({
    title: scenario.label,
    prompt: scenario.instructions,
    timeOfDay: 'any',
    trigger: { phrase: scenario.trigger },
    action: { learnedSkillId: skill?.id, instruction: scenario.action },
    confidence: 0.82,
    consentState: 'accepted',
  });
  return skill;
}
