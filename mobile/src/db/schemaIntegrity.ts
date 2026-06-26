export type RequiredTable = {
  name: string;
  columns: string[];
};

export const AGA_REQUIRED_TABLES: RequiredTable[] = [
  { name: 'user_preferences', columns: ['id'] },
  { name: 'memory_facts', columns: ['id', 'text', 'createdAt'] },
  { name: 'reminders', columns: ['id', 'text', 'dueAt'] },
  { name: 'routines', columns: ['id'] },
  { name: 'event_log', columns: ['id', 'kind', 'createdAt'] },
  { name: 'conversations', columns: ['id', 'createdAt'] },
  { name: 'messages', columns: ['id', 'role', 'content', 'createdAt'] },
];

export type SchemaIntegrityIssue = {
  table: string;
  column?: string;
  message: string;
};

export async function inspectSchemaIntegrity(db: { all?: Function; getAllAsync?: Function }): Promise<SchemaIntegrityIssue[]> {
  const all = async (sql: string) => {
    if (typeof db.all === 'function') return db.all(sql);
    if (typeof db.getAllAsync === 'function') return db.getAllAsync(sql);
    return [];
  };
  const tableRows = await all("SELECT name FROM sqlite_master WHERE type='table'");
  const tableNames = new Set((tableRows || []).map((r: any) => String(r.name)));
  const issues: SchemaIntegrityIssue[] = [];
  for (const table of AGA_REQUIRED_TABLES) {
    if (!tableNames.has(table.name)) {
      issues.push({ table: table.name, message: `Missing required table ${table.name}.` });
      continue;
    }
    const pragmaRows = await all(`PRAGMA table_info(${table.name})`);
    const columns = new Set((pragmaRows || []).map((r: any) => String(r.name)));
    for (const column of table.columns) {
      if (!columns.has(column)) issues.push({ table: table.name, column, message: `Missing required column ${table.name}.${column}.` });
    }
  }
  return issues;
}
