/**
 * Vitest globalSetup — runs once before all integration test files.
 * Creates (or recreates) the database schema.
 */
import postgres from 'postgres';

import { TEST_DATABASE_URL } from './setup.js';

export async function setup(): Promise<void> {
  const client = postgres(TEST_DATABASE_URL, { max: 1 });

  await client.unsafe(`DROP TABLE IF EXISTS github_tokens CASCADE`);
  await client.unsafe(`DROP TABLE IF EXISTS api_keys CASCADE`);
  await client.unsafe(`DROP TABLE IF EXISTS sessions CASCADE`);
  await client.unsafe(`DROP TABLE IF EXISTS subscriptions CASCADE`);
  await client.unsafe(`DROP TABLE IF EXISTS repo_states CASCADE`);
  await client.unsafe(`DROP TABLE IF EXISTS users CASCADE`);

  await client.unsafe(`
    CREATE TABLE users (
      id            SERIAL PRIMARY KEY,
      github_id     INTEGER NOT NULL UNIQUE,
      username      VARCHAR(255) NOT NULL,
      avatar_url    VARCHAR(500),
      created_at    TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await client.unsafe(`
    CREATE TABLE sessions (
      id            SERIAL PRIMARY KEY,
      token         VARCHAR(64) NOT NULL UNIQUE,
      user_id       INTEGER NOT NULL REFERENCES users(id),
      created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
      expires_at    TIMESTAMP NOT NULL
    )
  `);

  await client.unsafe(`
    CREATE TABLE subscriptions (
      id            SERIAL PRIMARY KEY,
      email         VARCHAR(255) NOT NULL,
      repo          VARCHAR(255) NOT NULL,
      confirmed     BOOLEAN NOT NULL DEFAULT FALSE,
      token         VARCHAR(64) NOT NULL UNIQUE,
      created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(email, repo)
    )
  `);

  await client.unsafe(`
    CREATE TABLE repo_states (
      repo          VARCHAR(255) PRIMARY KEY,
      last_seen_tag VARCHAR(255),
      last_checked  TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await client.unsafe(`
    CREATE TABLE api_keys (
      id            SERIAL PRIMARY KEY,
      name          VARCHAR(255) NOT NULL DEFAULT 'Unnamed key',
      key_hash      CHAR(64) NOT NULL UNIQUE,
      key_hint      VARCHAR(8) NOT NULL DEFAULT '',
      created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
      expires_at    TIMESTAMP,
      last_used_at  TIMESTAMP,
      usage_count   INTEGER NOT NULL DEFAULT 0,
      usage_quota   INTEGER NOT NULL DEFAULT 1000,
      user_id       INTEGER NOT NULL REFERENCES users(id)
    )
  `);

  await client.unsafe(`
    CREATE TABLE github_tokens (
      id            SERIAL PRIMARY KEY,
      name          VARCHAR(255) NOT NULL DEFAULT 'Unnamed token',
      token         VARCHAR(500) NOT NULL,
      token_hint    VARCHAR(8) NOT NULL DEFAULT '',
      user_id       INTEGER NOT NULL REFERENCES users(id),
      created_at    TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await client.end();
}
