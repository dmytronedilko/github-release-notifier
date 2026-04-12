import { eq } from 'drizzle-orm';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

import { subscriptions, repoStates } from '../db/schema.js';
import type { GithubClient } from '../plugins/github.js';
import type { Mailer } from '../plugins/mailer.js';
import { SubscriptionService } from '../services/SubscriptionService.js';

import { makeGithub, makeMailer } from './helpers.js';
import { setupDatabase, teardownDatabase, cleanTables, getTestDb } from './setup.js';

describe('SubscriptionService (integration)', () => {
  let db: ReturnType<typeof getTestDb>;
  let github: GithubClient;
  let mailer: Mailer;
  let service: SubscriptionService;

  beforeAll(() => {
    db = setupDatabase();
  });

  afterAll(async () => {
    await teardownDatabase();
  });

  beforeEach(async () => {
    await cleanTables();
    github = makeGithub();
    mailer = makeMailer();
    service = new SubscriptionService(db, github, mailer);
  });

  // ─── subscribe ──────────────────────────────────────────────────────────────

  describe('subscribe', () => {
    it('inserts a subscription and repo state row', async () => {
      await service.subscribe('alice@example.com', 'owner/repo');

      const subs = await db.select().from(subscriptions);
      expect(subs).toHaveLength(1);
      expect(subs[0].email).toBe('alice@example.com');
      expect(subs[0].repo).toBe('owner/repo');
      expect(subs[0].confirmed).toBe(false);
      expect(subs[0].token).toBeTruthy();

      const states = await db.select().from(repoStates);
      expect(states).toHaveLength(1);
      expect(states[0].repo).toBe('owner/repo');
      expect(states[0].lastSeenTag).toBe('v1.0.0');
    });

    it('sends a confirmation email with the generated token', async () => {
      await service.subscribe('alice@example.com', 'owner/repo');

      const subs = await db.select().from(subscriptions);
      expect(mailer.sendConfirmationEmail).toHaveBeenCalledWith('alice@example.com', subs[0].token);
    });

    it('does not duplicate repo state for second subscriber to same repo', async () => {
      await service.subscribe('alice@example.com', 'owner/repo');
      await service.subscribe('bob@example.com', 'owner/repo');

      const states = await db.select().from(repoStates);
      expect(states).toHaveLength(1);

      const subs = await db.select().from(subscriptions);
      expect(subs).toHaveLength(2);
    });

    it('rejects duplicate email+repo', async () => {
      await service.subscribe('alice@example.com', 'owner/repo');

      await expect(service.subscribe('alice@example.com', 'owner/repo')).rejects.toThrow(
        'Email already subscribed to this repository',
      );
    });

    it('rejects invalid email', async () => {
      await expect(service.subscribe('bad', 'owner/repo')).rejects.toThrow('Invalid email format');
    });

    it('rejects invalid repo format', async () => {
      await expect(service.subscribe('a@b.com', 'noslash')).rejects.toThrow('Invalid repo format');
    });

    it('rejects when GitHub repo does not exist', async () => {
      github = makeGithub({ checkRepo: vi.fn().mockResolvedValue(false) });
      service = new SubscriptionService(db, github, mailer);

      await expect(service.subscribe('a@b.com', 'owner/repo')).rejects.toThrow(
        'Repository not found on GitHub',
      );

      const subs = await db.select().from(subscriptions);
      expect(subs).toHaveLength(0);
    });
  });

  // ─── confirm ────────────────────────────────────────────────────────────────

  describe('confirm', () => {
    it('sets confirmed to true', async () => {
      await service.subscribe('alice@example.com', 'owner/repo');
      const [sub] = await db.select().from(subscriptions);

      await service.confirm(sub.token);

      const [updated] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.token, sub.token));
      expect(updated.confirmed).toBe(true);
    });

    it('rejects unknown token', async () => {
      await expect(service.confirm('nonexistent')).rejects.toThrow('Token not found');
    });

    it('rejects already-confirmed subscription', async () => {
      await service.subscribe('alice@example.com', 'owner/repo');
      const [sub] = await db.select().from(subscriptions);
      await service.confirm(sub.token);

      await expect(service.confirm(sub.token)).rejects.toThrow('Subscription already confirmed');
    });
  });

  // ─── unsubscribe ────────────────────────────────────────────────────────────

  describe('unsubscribe', () => {
    it('deletes the subscription row', async () => {
      await service.subscribe('alice@example.com', 'owner/repo');
      const [sub] = await db.select().from(subscriptions);

      await service.unsubscribe(sub.token);

      const remaining = await db.select().from(subscriptions);
      expect(remaining).toHaveLength(0);
    });

    it('rejects unknown token', async () => {
      await expect(service.unsubscribe('nonexistent')).rejects.toThrow('Token not found');
    });
  });

  // ─── getSubscriptions ───────────────────────────────────────────────────────

  describe('getSubscriptions', () => {
    it('returns all subscriptions for an email with repo state', async () => {
      await service.subscribe('alice@example.com', 'owner/repo');

      const result = await service.getSubscriptions('alice@example.com');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        email: 'alice@example.com',
        repo: 'owner/repo',
        confirmed: false,
        last_seen_tag: 'v1.0.0',
      });
    });

    it('returns empty array for unknown email', async () => {
      const result = await service.getSubscriptions('nobody@example.com');
      expect(result).toEqual([]);
    });

    it('rejects invalid email', async () => {
      await expect(service.getSubscriptions('bad')).rejects.toThrow('Invalid email format');
    });
  });
});
