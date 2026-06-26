import { all, run } from '../db/sqlite';
import { migrate } from '../db/migrations';
import { getRemoteSkills } from '../remote/config';
import { GUIDED_SESSION_PRESETS, buildGuidedSessionInstructions, type GuidedSessionSegment } from '../sessions/guidedSessions';

export type AgaSkillSource = 'builtin' | 'remote' | 'learned';

export type AgaSkill = {
  id: string;
  label: string;
  description?: string;
  aliases: string[];
  instructions: string;
  segments?: GuidedSessionSegment[];
  tools?: string[];
  source: AgaSkillSource;
  kind?: string;
  targetLanguage?: string | null;
  theme?: string | null;
  iconUrl?: string | null;
  imageUrl?: string | null;
  confidence?: number;
};

function safeJson<T>(raw: unknown, fallback: T): T {
  if (!raw || typeof raw !== 'string') return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function normalizeAliases(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 32);
}

export function builtinGuidedSkills(): AgaSkill[] {
  return GUIDED_SESSION_PRESETS.map((preset) => ({
    id: preset.id,
    label: preset.label,
    description: preset.description,
    aliases: preset.aliases,
    instructions: buildGuidedSessionInstructions(preset),
    segments: preset.segments,
    tools: ['guided_session_control', 'reflect_session', 'update_user_profile', 'get_user_profile'],
    source: 'builtin',
    kind: preset.kind,
    theme: preset.theme ?? null,
  }));
}

export function remoteConfigSkills(): AgaSkill[] {
  return getRemoteSkills().map((skill) => ({
    id: skill.id,
    label: skill.label,
    description: skill.description,
    aliases: normalizeAliases(skill.aliases),
    instructions: skill.instructions,
    tools: normalizeAliases(skill.toolNames),
    source: 'remote',
    kind: skill.kind || 'remote',
    targetLanguage: skill.targetLanguage ?? null,
    theme: skill.theme ?? null,
    iconUrl: skill.iconUrl ?? null,
    imageUrl: skill.imageUrl ?? null,
  }));
}

export async function learnedSkills(): Promise<AgaSkill[]> {
  try {
    await migrate();
    const rows = await all<any>("SELECT * FROM learned_skills WHERE enabled = 1 ORDER BY confidence DESC, updatedAt DESC LIMIT 64");
    return rows.map((row) => ({
      id: String(row.id),
      label: String(row.label),
      aliases: safeJson<string[]>(row.aliasesJson, []),
      instructions: String(row.instructions || ''),
      segments: safeJson<GuidedSessionSegment[] | undefined>(row.segmentsJson, undefined),
      tools: safeJson<string[]>(row.toolsJson, []),
      source: row.source === 'builtin' || row.source === 'remote' ? row.source : 'learned',
      confidence: Number(row.confidence ?? 0.7),
    }));
  } catch {
    return [];
  }
}

export async function getSkillRegistry(): Promise<AgaSkill[]> {
  const skills = [...builtinGuidedSkills(), ...remoteConfigSkills(), ...(await learnedSkills())];
  const map = new Map<string, AgaSkill>();
  for (const skill of skills) map.set(skill.id, skill);
  return Array.from(map.values());
}

export async function findSkill(input: unknown): Promise<AgaSkill | null> {
  const clean = String(input ?? '').trim().toLowerCase();
  if (!clean) return null;
  const skills = await getSkillRegistry();
  return skills.find((skill) => {
    if (skill.id.toLowerCase() === clean || skill.label.toLowerCase() === clean) return true;
    if (skill.kind && skill.kind.toLowerCase() === clean) return true;
    return skill.aliases.some((alias) => {
      const a = alias.toLowerCase();
      return clean.includes(a) || a.includes(clean);
    });
  }) ?? null;
}

function skillIdFromLabel(label: string) {
  return `learned_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 42) || Date.now().toString(36)}`;
}

export async function writeLearnedSkill(input: {
  id?: string;
  label: string;
  aliases?: string[];
  instructions: string;
  segments?: GuidedSessionSegment[];
  tools?: string[];
  confidence?: number;
}) {
  await migrate();
  const label = String(input.label || 'Learned skill').trim();
  const id = String(input.id || skillIdFromLabel(label));
  await run(
    `INSERT OR REPLACE INTO learned_skills (id, label, aliasesJson, instructions, segmentsJson, toolsJson, source, confidence, enabled, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, 'learned', ?, 1, COALESCE((SELECT createdAt FROM learned_skills WHERE id = ?), CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)`,
    [
      id,
      label,
      JSON.stringify(normalizeAliases(input.aliases)),
      String(input.instructions || '').trim(),
      input.segments ? JSON.stringify(input.segments) : null,
      JSON.stringify(normalizeAliases(input.tools)),
      Number.isFinite(input.confidence) ? Number(input.confidence) : 0.7,
      id,
    ],
  );
  return findSkill(id);
}

export function skillPromptBlock(skills: AgaSkill[]) {
  if (!skills.length) return '';
  const lines = skills.slice(0, 24).map((skill) => {
    const aliases = skill.aliases.length ? ` aliases: ${skill.aliases.slice(0, 6).join(', ')}` : '';
    return `- ${skill.label} [${skill.source}${skill.kind ? `/${skill.kind}` : ''}]${aliases}`;
  });
  return `Unified skill registry available:\n${lines.join('\n')}\nStart skills through start_skill/start_guided_session and keep voice-only pacing.`;
}
