import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(databaseUrl: string): Promise<void> {
  const migrationClient = postgres(databaseUrl, {
    max: 1,
    ssl: process.env.NODE_ENV === 'production' ? 'require' : false,
  });
  const db = drizzle(migrationClient);

  await migrate(db, {
    migrationsFolder: resolve(__dirname, '../../drizzle'),
  });

  await migrationClient.end();
}
