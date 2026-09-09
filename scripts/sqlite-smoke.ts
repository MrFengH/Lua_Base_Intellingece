import { LocalSqliteDatabase } from '@/infrastructure';

const database = new LocalSqliteDatabase(':memory:');
try {
  const row = database.connection.prepare('SELECT sqlite_version() AS version').get() as {
    version: string;
  };
  database.transaction(() => {
    database.connection.exec('CREATE TABLE smoke (id INTEGER PRIMARY KEY, value TEXT) STRICT;');
    database.connection.prepare('INSERT INTO smoke (value) VALUES (?)').run('ok');
  });
  const saved = database.connection.prepare('SELECT value FROM smoke').get() as { value: string };
  if (saved.value !== 'ok') throw new Error('SQLite transaction did not persist the test row.');
  console.log(`PASS: node:sqlite ${row.version} transaction completed`);
} finally {
  database.close();
}
