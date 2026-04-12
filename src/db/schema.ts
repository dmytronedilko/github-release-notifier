import {
  pgTable,
  serial,
  varchar,
  char,
  boolean,
  timestamp,
  integer,
  unique,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  githubId: integer('github_id').notNull().unique(),
  username: varchar('username', { length: 255 }).notNull(),
  avatarUrl: varchar('avatar_url', { length: 500 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: serial('id').primaryKey(),
  token: varchar('token', { length: 64 }).notNull().unique(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
});

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: serial('id').primaryKey(),
    email: varchar('email', { length: 255 }).notNull(),
    repo: varchar('repo', { length: 255 }).notNull(),
    confirmed: boolean('confirmed').notNull().default(false),
    token: varchar('token', { length: 64 }).notNull().unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    emailRepoUnique: unique().on(t.email, t.repo),
  }),
);

export const repoStates = pgTable('repo_states', {
  repo: varchar('repo', { length: 255 }).primaryKey(),
  lastSeenTag: varchar('last_seen_tag', { length: 255 }),
  lastChecked: timestamp('last_checked').notNull().defaultNow(),
});

export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull().default('Unnamed key'),
  keyHash: char('key_hash', { length: 64 }).notNull().unique(),
  keyHint: varchar('key_hint', { length: 8 }).notNull().default(''),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at'),
  lastUsedAt: timestamp('last_used_at'),
  usageCount: integer('usage_count').notNull().default(0),
  usageQuota: integer('usage_quota').notNull().default(1000),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
});

export const githubTokens = pgTable('github_tokens', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull().default('Unnamed token'),
  token: varchar('token', { length: 500 }).notNull(),
  tokenHint: varchar('token_hint', { length: 8 }).notNull().default(''),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
