import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { subscriptions } from '../db/schema.js';
import type { Mailer } from '../plugins/mailer.js';
import { NotifierService } from '../services/NotifierService.js';

import { makeMailer } from './helpers.js';
import { setupDatabase, teardownDatabase, cleanTables, getTestDb } from './setup.js';

describe('NotifierService (integration)', () => {
  let db: ReturnType<typeof getTestDb>;
  let mailer: Mailer;
  let service: NotifierService;

  beforeAll(() => {
    db = setupDatabase();
  });

  afterAll(async () => {
    await teardownDatabase();
  });

  beforeEach(async () => {
    await cleanTables();
    mailer = makeMailer();
    service = new NotifierService(db, mailer);
  });

  it('sends emails only to confirmed subscribers of the given repo', async () => {
    await db.insert(subscriptions).values([
      { email: 'alice@example.com', repo: 'owner/repo', confirmed: true, token: 'tok-a' },
      { email: 'bob@example.com', repo: 'owner/repo', confirmed: false, token: 'tok-b' },
      { email: 'carol@example.com', repo: 'other/repo', confirmed: true, token: 'tok-c' },
    ]);

    await service.notifySubscribers('owner/repo', 'v2.0.0');

    expect(mailer.sendReleaseEmail).toHaveBeenCalledTimes(1);
    expect(mailer.sendReleaseEmail).toHaveBeenCalledWith(
      'alice@example.com',
      'owner/repo',
      'v2.0.0',
      'tok-a',
    );
  });

  it('sends nothing when no confirmed subscribers exist', async () => {
    await db
      .insert(subscriptions)
      .values([{ email: 'bob@example.com', repo: 'owner/repo', confirmed: false, token: 'tok-b' }]);

    await service.notifySubscribers('owner/repo', 'v1.0.0');

    expect(mailer.sendReleaseEmail).not.toHaveBeenCalled();
  });

  it('sends to multiple confirmed subscribers', async () => {
    await db.insert(subscriptions).values([
      { email: 'alice@example.com', repo: 'owner/repo', confirmed: true, token: 'tok-a' },
      { email: 'bob@example.com', repo: 'owner/repo', confirmed: true, token: 'tok-b' },
    ]);

    await service.notifySubscribers('owner/repo', 'v3.0.0');

    expect(mailer.sendReleaseEmail).toHaveBeenCalledTimes(2);
  });
});
