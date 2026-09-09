import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  applyDevelopmentSeed,
  LocalSqliteDatabase,
  SqliteInstalledBaseRepository,
} from '@/infrastructure';

const databasePath =
  process.env.CIB_DATABASE_PATH ?? resolve('data', 'customer-installed-base.sqlite');
mkdirSync(dirname(databasePath), { recursive: true });
const database = new LocalSqliteDatabase(databasePath);
try {
  const repository = new SqliteInstalledBaseRepository(database);
  applyDevelopmentSeed(repository);
  console.log(`Seed ready: ${repository.list().length} synthetic customers in ${databasePath}`);
} finally {
  database.close();
}
