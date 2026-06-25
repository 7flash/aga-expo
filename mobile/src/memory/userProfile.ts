import { addMemory, loadPreferences, logEvent, savePreferences } from '../db/localStore';

export type UserProfile = {
  updatedAt: string;
  communicationStyle?: string;
  effectiveTechniques: string[];
  emotionalPatterns: string[];
  goals: string[];
  rituals: string[];
  notes: string[];
};

function emptyProfile(): UserProfile {
  return {
    updatedAt: new Date().toISOString(),
    effectiveTechniques: [],
    emotionalPatterns: [],
    goals: [],
    rituals: [],
    notes: [],
  };
}

function normalizeProfile(raw: unknown): UserProfile {
  const base = emptyProfile();
  const input = raw && typeof raw === 'object' ? raw as any : {};
  const list = (value: unknown) => Array.isArray(value) ? value.map((item) => String(item ?? '').trim()).filter(Boolean).slice(-24) : [];
  return {
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : base.updatedAt,
    communicationStyle: typeof input.communicationStyle === 'string' ? input.communicationStyle : undefined,
    effectiveTechniques: list(input.effectiveTechniques),
    emotionalPatterns: list(input.emotionalPatterns),
    goals: list(input.goals),
    rituals: list(input.rituals),
    notes: list(input.notes),
  };
}

function pushUnique(list: string[], value: string, max = 24) {
  const clean = value.trim();
  if (!clean) return list;
  const without = list.filter((item) => item.toLowerCase() !== clean.toLowerCase());
  return [...without, clean].slice(-max);
}

export async function getUserProfile(): Promise<UserProfile> {
  const prefs = await loadPreferences();
  return normalizeProfile((prefs as any).userProfile);
}

export async function saveUserProfile(profile: UserProfile) {
  const next = normalizeProfile({ ...profile, updatedAt: new Date().toISOString() });
  await savePreferences({ userProfile: next } as any);
  await logEvent('profile.save', `goals=${next.goals.length} techniques=${next.effectiveTechniques.length}`);
  return next;
}

export async function clearUserProfile() {
  await savePreferences({ userProfile: undefined } as any);
  await logEvent('profile.clear', 'user requested profile reset');
}

export function profileFromPrefs(prefs: unknown): UserProfile {
  return normalizeProfile((prefs as any)?.userProfile);
}

export async function updateUserProfileFromSignal(input: {
  note?: string;
  goal?: string;
  technique?: string;
  emotionalPattern?: string;
  ritual?: string;
  communicationStyle?: string;
}) {
  const profile = await getUserProfile();
  const next: UserProfile = {
    ...profile,
    updatedAt: new Date().toISOString(),
    communicationStyle: input.communicationStyle?.trim() || profile.communicationStyle,
    effectiveTechniques: input.technique ? pushUnique(profile.effectiveTechniques, input.technique) : profile.effectiveTechniques,
    emotionalPatterns: input.emotionalPattern ? pushUnique(profile.emotionalPatterns, input.emotionalPattern) : profile.emotionalPatterns,
    goals: input.goal ? pushUnique(profile.goals, input.goal) : profile.goals,
    rituals: input.ritual ? pushUnique(profile.rituals, input.ritual) : profile.rituals,
    notes: input.note ? pushUnique(profile.notes, input.note, 40) : profile.notes,
  };
  await saveUserProfile(next);
  const memory = [input.goal && `goal: ${input.goal}`, input.technique && `works well: ${input.technique}`, input.emotionalPattern && `pattern: ${input.emotionalPattern}`].filter(Boolean).join('; ');
  if (memory) await addMemory(memory);
  return next;
}

export function profilePromptBlock(profile: UserProfile | null | undefined) {
  if (!profile) return 'User profile: no durable profile yet.';
  const lines = [
    profile.communicationStyle ? `Communication style: ${profile.communicationStyle}` : '',
    profile.goals.length ? `Goals: ${profile.goals.slice(-6).join('; ')}` : '',
    profile.effectiveTechniques.length ? `Techniques that help: ${profile.effectiveTechniques.slice(-6).join('; ')}` : '',
    profile.emotionalPatterns.length ? `Patterns noticed: ${profile.emotionalPatterns.slice(-6).join('; ')}` : '',
    profile.rituals.length ? `Rituals: ${profile.rituals.slice(-6).join('; ')}` : '',
  ].filter(Boolean);
  return lines.length ? `User profile:\n${lines.join('\n')}` : 'User profile: not enough observations yet.';
}
