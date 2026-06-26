import { listMessages, logEvent, searchMemories } from '../db/localStore';
import { writeSubconsciousFact, type SubconsciousFact } from '../memory/subconsciousStore';
import { backfillSubconsciousFromProfile } from '../memory/subconsciousRag';

function hourLocal() { return new Date().getHours(); }
function isNightIdleWindow() { const h = hourLocal(); return h >= 1 && h <= 5; }

function classifyLine(text: string): SubconsciousFact | null {
  const lower = text.toLowerCase();
  if (/box breathing|breathing|breathe|wind[- ]?down|meditation|hypnosis/.test(lower)) return { kind: 'procedural', text: `User may respond to: ${text.slice(0, 160)}`, source: 'dream', weight: 0.55 };
  if (/stress|anxious|conflict|angry|sad|overwhelmed|panic/.test(lower)) return { kind: 'affective', text: `Emotional context observed: ${text.slice(0, 160)}`, source: 'dream', weight: 0.5 };
  if (/when i say|routine|every night|every morning|remind me|help me build a habit/.test(lower)) return { kind: 'routine', text: `Possible routine/scenario: ${text.slice(0, 160)}`, source: 'dream', weight: 0.62 };
  return null;
}

/**
 * Night/idle synthesis pass.
 *
 * This is intentionally local-first. If a server LLM summarizer is later wired
 * in, it should write through the same SubconsciousFact API rather than bloating
 * the wake prompt with a monolithic userProfile.
 */
export async function runSubconsciousSynthesis(options: { force?: boolean; limit?: number } = {}) {
  if (!options.force && !isNightIdleWindow()) return { skipped: true, reason: 'outside_night_idle_window', written: 0 };
  const limit = options.limit || 40;
  const [messages, memories] = await Promise.all([
    listMessages(limit).catch(() => [] as any[]),
    searchMemories(undefined, limit).catch(() => [] as any[]),
  ]);
  let written = await backfillSubconsciousFromProfile().catch(() => 0);
  const seen = new Set<string>();
  for (const item of [...messages, ...memories]) {
    const text = String(item.text || item.content || '').trim();
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    const fact = classifyLine(text);
    if (fact) {
      await writeSubconsciousFact(fact);
      written += 1;
    }
  }
  await logEvent('dream.subconscious_synthesis', `written=${written} scanned=${seen.size}`).catch(() => undefined);
  return { skipped: false, written, scanned: seen.size };
}
