import * as SQLite from 'expo-sqlite';

export type AgaKvDatabase = any;

export async function openAgaKvDatabase(name: string): Promise<AgaKvDatabase | null> {
  const anySQLite = SQLite as any;
  if (typeof anySQLite.openDatabaseAsync === 'function') return anySQLite.openDatabaseAsync(name);
  if (typeof anySQLite.openDatabaseSync === 'function') return anySQLite.openDatabaseSync(name);
  if (typeof anySQLite.openDatabase === 'function') return anySQLite.openDatabase(name);
  return null;
}
