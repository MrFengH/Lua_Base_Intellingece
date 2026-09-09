import { INITIAL_MIGRATION_ID, INITIAL_MIGRATION_SQL } from './001-initial';
import {
  SESSION_SEED_OWNERSHIP_MIGRATION_ID,
  SESSION_SEED_OWNERSHIP_MIGRATION_SQL,
} from './002-session-seed-ownership';

export * from './001-initial';
export * from './002-session-seed-ownership';

export interface Migration {
  id: string;
  sql: string;
}

/** Applied in order, each in its own transaction, and each recorded in `schema_migrations`. */
export const MIGRATIONS: readonly Migration[] = [
  { id: INITIAL_MIGRATION_ID, sql: INITIAL_MIGRATION_SQL },
  { id: SESSION_SEED_OWNERSHIP_MIGRATION_ID, sql: SESSION_SEED_OWNERSHIP_MIGRATION_SQL },
];
