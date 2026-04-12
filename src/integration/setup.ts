/**
 * Shared setup for integration tests.
 *
 * Connects to the test PostgreSQL database and exposes helpers to obtain a
 * Drizzle `Db` instance and to clean up between tests.
 *
 * Schema creation is handled by globalSetup (see global-setup.ts).
 */
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../db/schema.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://notifier_user:notifier_pass@localhost:5433/notifier_db';

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;

/**
 * Called in beforeAll of each test file. Opens a connection pool.
 */
export function setupDatabase(): ReturnType<typeof drizzle<typeof schema>> {
  client = postgres(TEST_DATABASE_URL, { max: 5 });
  db = drizzle(client, { schema });
  return db;
}

export function getTestDb(): ReturnType<typeof drizzle<typeof schema>> {
  return db;
}

/**
 * Truncates all tables between tests for isolation.
 */
export async function cleanTables(): Promise<void> {
  await db.execute(
    sql`TRUNCATE users, sessions, subscriptions, repo_states, api_keys, github_tokens RESTART IDENTITY CASCADE`,
  );
}

/**
 * Closes the connection pool after all tests in a file.
 */
export async function teardownDatabase(): Promise<void> {
  await client.end();
}
