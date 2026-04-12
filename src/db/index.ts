import { type PostgresJsDatabase, drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema.js';

type DbInstance = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: DbInstance;
  close: () => Promise<void>;
}

export function initDb(databaseUrl: string): DbHandle {
  const client = postgres(databaseUrl, {
    ssl: process.env.NODE_ENV === 'production' ? 'require' : false,
  });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end() };
}

export type Db = DbInstance;
