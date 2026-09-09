import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations';

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
    const isApplied = this.connection.prepare('SELECT id FROM schema_migrations WHERE id = ?');
    const record = this.connection.prepare(
      'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
    );
    MIGRATIONS.forEach((migration) => {
      if (isApplied.get(migration.id)) return;
      this.transaction(() => {
        this.connection.exec(migration.sql);
        record.run(migration.id, new Date().toISOString());
      });
    });
  }
}
