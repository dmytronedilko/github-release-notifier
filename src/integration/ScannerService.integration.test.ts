import { eq } from 'drizzle-orm';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { subscriptions, repoStates } from '../db/schema.js';
import { NotifierService } from '../services/NotifierService.js';
import { ScannerService } from '../services/ScannerService.js';

import { makeGithubWithTags, makeMailer } from './helpers.js';
import { setupDatabase, teardownDatabase, cleanTables, getTestDb } from './setup.js';

describe('ScannerService (integration)', () => {
  let db: ReturnType<typeof getTestDb>;

  beforeAll(() => {
    db = setupDatabase();
  });

  afterAll(async () => {
    await teardownDatabase();
  });

  beforeEach(async () => {
    await cleanTables();
  });

  async function seedSubscription(email: string, repo: string, confirmed: boolean, token: string) {
    await db.insert(subscriptions).values({ email, repo, confirmed, token });
  }

  async function seedRepoState(repo: string, lastSeenTag: string | null) {
    await db.insert(repoStates).values({ repo, lastSeenTag });
  }

  it('detects a new release, updates repo state, and sends notifications', async () => {
    await seedSubscription('alice@example.com', 'owner/repo', true, 'tok-a');
    await seedRepoState('owner/repo', 'v1.0.0');

    const mailer = makeMailer();
    const github = makeGithubWithTags({ 'owner/repo': 'v2.0.0' });
    const notifier = new NotifierService(db, mailer);
    const scanner = new ScannerService(db, github, notifier);

    await scanner.scan();

    // repo_states updated
    const [state] = await db.select().from(repoStates).where(eq(repoStates.repo, 'owner/repo'));
    expect(state.lastSeenTag).toBe('v2.0.0');

    // notification sent
    expect(mailer.sendReleaseEmail).toHaveBeenCalledWith(
      'alice@example.com',
      'owner/repo',
      'v2.0.0',
      'tok-a',
    );
  });

  it('does not notify when tag has not changed', async () => {
    await seedSubscription('alice@example.com', 'owner/repo', true, 'tok-a');
    await seedRepoState('owner/repo', 'v1.0.0');

    const mailer = makeMailer();
    const github = makeGithubWithTags({ 'owner/repo': 'v1.0.0' });
    const notifier = new NotifierService(db, mailer);
    const scanner = new ScannerService(db, github, notifier);

    await scanner.scan();

    expect(mailer.sendReleaseEmail).not.toHaveBeenCalled();
  });

  it('skips unconfirmed subscriptions — does not scan their repos', async () => {
    await seedSubscription('bob@example.com', 'owner/repo', false, 'tok-b');
    await seedRepoState('owner/repo', 'v1.0.0');

    const mailer = makeMailer();
    const github = makeGithubWithTags({ 'owner/repo': 'v2.0.0' });
    const notifier = new NotifierService(db, mailer);
    const scanner = new ScannerService(db, github, notifier);

    await scanner.scan();

    // No GitHub API call for unconfirmed repos
    expect(github.getLatestTag).not.toHaveBeenCalled();
    expect(mailer.sendReleaseEmail).not.toHaveBeenCalled();
  });

  it('handles multiple repos independently', async () => {
    await seedSubscription('alice@example.com', 'a/one', true, 'tok-1');
    await seedSubscription('bob@example.com', 'b/two', true, 'tok-2');
    await seedRepoState('a/one', 'v1.0.0');
    await seedRepoState('b/two', 'v3.0.0');

    const mailer = makeMailer();
    const github = makeGithubWithTags({ 'a/one': 'v2.0.0', 'b/two': 'v3.0.0' });
    const notifier = new NotifierService(db, mailer);
    const scanner = new ScannerService(db, github, notifier);

    await scanner.scan();

    // Only a/one has a new release
    expect(mailer.sendReleaseEmail).toHaveBeenCalledTimes(1);
    expect(mailer.sendReleaseEmail).toHaveBeenCalledWith(
      'alice@example.com',
      'a/one',
      'v2.0.0',
      'tok-1',
    );

    // Only a/one's state was updated
    const [stateA] = await db.select().from(repoStates).where(eq(repoStates.repo, 'a/one'));
    const [stateB] = await db.select().from(repoStates).where(eq(repoStates.repo, 'b/two'));
    expect(stateA.lastSeenTag).toBe('v2.0.0');
    expect(stateB.lastSeenTag).toBe('v3.0.0');
  });

  it('notifies all confirmed subscribers of a repo on new release', async () => {
    await seedSubscription('alice@example.com', 'owner/repo', true, 'tok-a');
    await seedSubscription('bob@example.com', 'owner/repo', true, 'tok-b');
    await seedSubscription('carol@example.com', 'owner/repo', false, 'tok-c');
    await seedRepoState('owner/repo', 'v1.0.0');

    const mailer = makeMailer();
    const github = makeGithubWithTags({ 'owner/repo': 'v2.0.0' });
    const notifier = new NotifierService(db, mailer);
    const scanner = new ScannerService(db, github, notifier);

    await scanner.scan();

    expect(mailer.sendReleaseEmail).toHaveBeenCalledTimes(2);
    expect(mailer.sendReleaseEmail).toHaveBeenCalledWith(
      'alice@example.com',
      'owner/repo',
      'v2.0.0',
      'tok-a',
    );
    expect(mailer.sendReleaseEmail).toHaveBeenCalledWith(
      'bob@example.com',
      'owner/repo',
      'v2.0.0',
      'tok-b',
    );
  });

  it('skips repo when GitHub returns null tag', async () => {
    await seedSubscription('alice@example.com', 'owner/repo', true, 'tok-a');
    await seedRepoState('owner/repo', 'v1.0.0');

    const mailer = makeMailer();
    const github = makeGithubWithTags({ 'owner/repo': null });
    const notifier = new NotifierService(db, mailer);
    const scanner = new ScannerService(db, github, notifier);

    await scanner.scan();

    expect(mailer.sendReleaseEmail).not.toHaveBeenCalled();

    // State unchanged
    const [state] = await db.select().from(repoStates).where(eq(repoStates.repo, 'owner/repo'));
    expect(state.lastSeenTag).toBe('v1.0.0');
  });
});
