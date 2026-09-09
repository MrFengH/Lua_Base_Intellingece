import { DatabaseSync } from 'node:sqlite';
import { INITIAL_MIGRATION_ID, INITIAL_MIGRATION_SQL } from './migrations/001-initial';

export class LocalSqliteDatabase {
  readonly connection: DatabaseSync;

  constructor(path: string) {
    this.connection = new DatabaseSync(path, { timeout: 5_000 });
    this.connection.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    this.migrate();
  }

  transaction<T>(operation: () => T): T {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.connection.exec('COMMIT');
      return result;
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.connection.close();
  }

  private migrate(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    const applied = this.connection
      .prepare('SELECT id FROM schema_migrations WHERE id = ?')
      .get(INITIAL_MIGRATION_ID);
    if (applied) return;
    this.transaction(() => {
      this.connection.exec(INITIAL_MIGRATION_SQL);
      this.connection
        .prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)')
        .run(INITIAL_MIGRATION_ID, new Date().toISOString());
    });
  }
}
