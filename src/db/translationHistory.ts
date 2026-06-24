import { all, run } from './sqlite';
import type { TranslationHistoryItem } from './schema';

export async function saveTranslationHistory(input: {
  sourceText: string;
  translatedText: string;
  fromLang?: string | null;
  toLang: string;
}) {
  await run(
    'INSERT INTO translation_history (sourceText, translatedText, fromLang, toLang) VALUES (?, ?, ?, ?)',
    [input.sourceText, input.translatedText, input.fromLang ?? null, input.toLang]
  );
}

export async function listTranslationHistory(limit = 10) {
  return all<TranslationHistoryItem>('SELECT * FROM translation_history ORDER BY id DESC LIMIT ?', [limit]);
}

export async function clearTranslationHistory() {
  await run('DELETE FROM translation_history');
}
