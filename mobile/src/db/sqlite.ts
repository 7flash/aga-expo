type SQLiteModule = {
  openDatabaseAsync?: (name: string) => Promise<any>;
  openDatabaseSync?: (name: string) => any;
};

let dbPromise: Promise<any> | null = null;

async function loadSQLite(): Promise<SQLiteModule | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-sqlite') as SQLiteModule;
  } catch {
    return null;
  }
}

export async function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const SQLite = await loadSQLite();
      if (!SQLite) throw new Error('expo-sqlite is not installed in this build.');
      if (typeof SQLite.openDatabaseAsync === 'function') return SQLite.openDatabaseAsync('aga.db');
      if (typeof SQLite.openDatabaseSync === 'function') return SQLite.openDatabaseSync('aga.db');
      throw new Error('This expo-sqlite version does not expose openDatabaseAsync/openDatabaseSync.');
    })();
  }
  return dbPromise;
}

export async function run(sql: string, params: unknown[] = []) {
  const db = await getDb();
  if (typeof db.runAsync === 'function') return db.runAsync(sql, params);
  if (typeof db.execAsync === 'function' && params.length === 0) return db.execAsync(sql);
  throw new Error('SQLite runAsync is unavailable.');
}

export async function all<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = await getDb();
  if (typeof db.getAllAsync === 'function') return db.getAllAsync(sql, params);
  throw new Error('SQLite getAllAsync is unavailable.');
}

export async function first<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await all<T>(sql, params);
  return rows[0] ?? null;
}

export async function transaction(work: () => Promise<void>) {
  // expo-sqlite async API serializes statements. This wrapper gives callers one semantic boundary.
  await run('BEGIN IMMEDIATE');
  try {
    await work();
    await run('COMMIT');
  } catch (error) {
    await run('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
