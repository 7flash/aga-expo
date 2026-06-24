import * as SQLite from 'expo-sqlite';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('aga.db');
  }
  return dbPromise;
}

export async function run(sql: string, params: unknown[] = []) {
  const db = await getDb();
  return db.runAsync(sql, params as any[]);
}

export async function all<T>(sql: string, params: unknown[] = []) {
  const db = await getDb();
  return db.getAllAsync<T>(sql, params as any[]);
}

export async function first<T>(sql: string, params: unknown[] = []) {
  const db = await getDb();
  return db.getFirstAsync<T>(sql, params as any[]);
}
