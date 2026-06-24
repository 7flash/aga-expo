import { first, run } from './sqlite';
import type { UserPreferences } from './schema';

export async function getPreferences(): Promise<UserPreferences> {
  const prefs = await first<UserPreferences>('SELECT * FROM user_preferences WHERE id = 1');
  if (!prefs) {
    await run('INSERT OR IGNORE INTO user_preferences (id) VALUES (1)');
    return getPreferences();
  }

  return {
    ...prefs,
    openaiApiKey: prefs.openaiApiKey || process.env.EXPO_PUBLIC_OPENAI_API_KEY || null,
    geminiApiKey: prefs.geminiApiKey || process.env.EXPO_PUBLIC_GEMINI_API_KEY || null,
    backendMode: (process.env.EXPO_PUBLIC_AGA_BACKEND_MODE as UserPreferences['backendMode']) || prefs.backendMode || 'openai-direct',
    openaiModel: process.env.EXPO_PUBLIC_OPENAI_MODEL || prefs.openaiModel || 'gpt-5.5',
    geminiModel: process.env.EXPO_PUBLIC_GEMINI_MODEL || prefs.geminiModel || 'gemini-2.5-flash',
  };
}

export async function updatePreferences(patch: Partial<UserPreferences>) {
  const keys = Object.keys(patch).filter((key) => key !== 'id' && key !== 'updatedAt') as (keyof UserPreferences)[];
  if (!keys.length) return getPreferences();
  const assignments = keys.map((key) => `${key} = ?`).join(', ');
  const values = keys.map((key) => patch[key]);
  await run(`UPDATE user_preferences SET ${assignments}, updatedAt = CURRENT_TIMESTAMP WHERE id = 1`, values);
  return getPreferences();
}
