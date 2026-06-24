import { first, run } from './sqlite';
import type { UserPreferences } from './schema';
import { MODEL_IDS, normalizeGeminiTextModel, normalizeOpenAIModel } from '../backend/modelIds';
import { SECRET_KEYS, getSecret, isSecureStoreAvailable, setSecret } from '../security/secureSecrets';

type PreferencePatch = Partial<UserPreferences>;

async function readSecretWithFallback(secretKey: string, sqliteValue: string | null | undefined, envValue: string | undefined) {
  const secure = await getSecret(secretKey);
  return secure || sqliteValue || envValue || null;
}

export async function getPreferences(): Promise<UserPreferences> {
  const prefs = await first<UserPreferences>('SELECT * FROM user_preferences WHERE id = 1');
  if (!prefs) {
    await run('INSERT OR IGNORE INTO user_preferences (id) VALUES (1)');
    return getPreferences();
  }

  const [openaiApiKey, geminiApiKey, remoteBackendToken] = await Promise.all([
    readSecretWithFallback(SECRET_KEYS.openaiApiKey, prefs.openaiApiKey, process.env.EXPO_PUBLIC_OPENAI_API_KEY),
    readSecretWithFallback(SECRET_KEYS.geminiApiKey, prefs.geminiApiKey, process.env.EXPO_PUBLIC_GEMINI_API_KEY),
    readSecretWithFallback(SECRET_KEYS.remoteBackendToken, prefs.remoteBackendToken, process.env.EXPO_PUBLIC_AGA_REMOTE_BACKEND_TOKEN),
  ]);

  return {
    ...prefs,
    openaiApiKey,
    geminiApiKey,
    backendMode: (process.env.EXPO_PUBLIC_AGA_BACKEND_MODE as UserPreferences['backendMode']) || prefs.backendMode || 'openai-direct',
    openaiModel: normalizeOpenAIModel(process.env.EXPO_PUBLIC_OPENAI_MODEL || prefs.openaiModel || MODEL_IDS.openaiChat),
    geminiModel: normalizeGeminiTextModel(process.env.EXPO_PUBLIC_GEMINI_MODEL || prefs.geminiModel || MODEL_IDS.geminiText),
    remoteBackendUrl: prefs.remoteBackendUrl || process.env.EXPO_PUBLIC_AGA_REMOTE_BACKEND_URL || null,
    remoteBackendToken,
    voiceLocale: prefs.voiceLocale || process.env.EXPO_PUBLIC_AGA_VOICE_LOCALE || 'en-US',
    firstRunComplete: Number(prefs.firstRunComplete ?? 0),
    speechWatchdogEnabled: Number(prefs.speechWatchdogEnabled ?? 1),
    proactiveEnabled: Number(prefs.proactiveEnabled ?? 1),
    localNotificationsEnabled: Number(prefs.localNotificationsEnabled ?? 1),
    quietHoursStart: prefs.quietHoursStart ?? null,
    quietHoursEnd: prefs.quietHoursEnd ?? null,
  };
}

export async function updatePreferences(patch: PreferencePatch) {
  const secureStoreAvailable = isSecureStoreAvailable();
  const sqlitePatch: PreferencePatch = { ...patch };

  if ('openaiApiKey' in sqlitePatch) {
    const savedSecurely = await setSecret(SECRET_KEYS.openaiApiKey, sqlitePatch.openaiApiKey);
    sqlitePatch.openaiApiKey = savedSecurely ? null : (sqlitePatch.openaiApiKey ?? null);
  }
  if ('geminiApiKey' in sqlitePatch) {
    const savedSecurely = await setSecret(SECRET_KEYS.geminiApiKey, sqlitePatch.geminiApiKey);
    sqlitePatch.geminiApiKey = savedSecurely ? null : (sqlitePatch.geminiApiKey ?? null);
  }
  if ('remoteBackendToken' in sqlitePatch) {
    const savedSecurely = await setSecret(SECRET_KEYS.remoteBackendToken, sqlitePatch.remoteBackendToken);
    sqlitePatch.remoteBackendToken = savedSecurely ? null : (sqlitePatch.remoteBackendToken ?? null);
  }

  if ('openaiModel' in sqlitePatch) sqlitePatch.openaiModel = normalizeOpenAIModel(sqlitePatch.openaiModel);
  if ('geminiModel' in sqlitePatch) sqlitePatch.geminiModel = normalizeGeminiTextModel(sqlitePatch.geminiModel);

  const keys = Object.keys(sqlitePatch).filter((key) => key !== 'id' && key !== 'updatedAt') as (keyof UserPreferences)[];
  if (!keys.length) return getPreferences();
  const assignments = keys.map((key) => `${key} = ?`).join(', ');
  const values = keys.map((key) => sqlitePatch[key]);
  await run(`UPDATE user_preferences SET ${assignments}, updatedAt = CURRENT_TIMESTAMP WHERE id = 1`, values);

  if (!secureStoreAvailable && ('openaiApiKey' in patch || 'geminiApiKey' in patch || 'remoteBackendToken' in patch)) {
    // SQLite fallback is intentionally preserved so existing builds continue to work before expo-secure-store is installed.
  }

  return getPreferences();
}
