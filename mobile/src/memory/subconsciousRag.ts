import { subconsciousContextBlock, writeSubconsciousFact, type SubconsciousFact } from './subconsciousStore';
import { getUserProfile } from './userProfile';

function profileToFacts(profile: Awaited<ReturnType<typeof getUserProfile>>): SubconsciousFact[] {
  const facts: SubconsciousFact[] = [];
  for (const technique of profile.effectiveTechniques || []) facts.push({ kind: 'procedural', text: `Helpful technique: ${technique}`, source: 'reflection', weight: 0.8 });
  for (const pattern of profile.emotionalPatterns || []) facts.push({ kind: 'affective', text: `Emotional pattern: ${pattern}`, source: 'reflection', weight: 0.75 });
  for (const ritual of profile.rituals || []) facts.push({ kind: 'routine', text: `Ritual: ${ritual}`, source: 'routine', weight: 0.7 });
  return facts;
}

export async function backfillSubconsciousFromProfile() {
  const profile = await getUserProfile();
  const facts = profileToFacts(profile);
  for (const fact of facts) await writeSubconsciousFact(fact);
  return facts.length;
}

export async function buildWakeRagContext(initialUserText: string) {
  const context = await subconsciousContextBlock(initialUserText, 5);
  return context ? `${context}\nUse this only if relevant. Do not mention retrieval or memory mechanics.` : '';
}
