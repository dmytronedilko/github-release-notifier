import { describe, it, expect, vi } from 'vitest';

import type { Db } from '../db/index.js';
import { NotifierService } from '../services/NotifierService.js';

import { makeMailer } from './helpers.js';

function makeMockDb(subscribers: { email: string; token: string }[]) {
  const mockChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(subscribers),
  };

  return {
    select: vi.fn().mockReturnValue(mockChain),
  };
}

describe('NotifierService.notifySubscribers()', () => {
  it('sends a release email to each confirmed subscriber', async () => {
    const subscribers = [
      { email: 'a@test.com', token: 'token-a' },
      { email: 'b@test.com', token: 'token-b' },
    ];
    const db = makeMockDb(subscribers);
    const mailer = makeMailer();
    const notifier = new NotifierService(db as unknown as Db, mailer);

    await notifier.notifySubscribers('owner/repo', 'v2.0.0');

    expect(mailer.sendReleaseEmail).toHaveBeenCalledTimes(2);
    expect(mailer.sendReleaseEmail).toHaveBeenCalledWith(
      'a@test.com',
      'owner/repo',
      'v2.0.0',
      'token-a',
    );
    expect(mailer.sendReleaseEmail).toHaveBeenCalledWith(
      'b@test.com',
      'owner/repo',
      'v2.0.0',
      'token-b',
    );
  });

  it('does not send any emails when there are no confirmed subscribers', async () => {
    const db = makeMockDb([]);
    const mailer = makeMailer();
    const notifier = new NotifierService(db as unknown as Db, mailer);

    await notifier.notifySubscribers('owner/repo', 'v2.0.0');

    expect(mailer.sendReleaseEmail).not.toHaveBeenCalled();
  });

  it('propagates mailer errors', async () => {
    const subscribers = [{ email: 'a@test.com', token: 'token-a' }];
    const db = makeMockDb(subscribers);
    const mailerError = new Error('SMTP connection refused');
    const mailer = makeMailer({
      sendReleaseEmail: vi.fn().mockRejectedValue(mailerError),
    });
    const notifier = new NotifierService(db as unknown as Db, mailer);

    await expect(notifier.notifySubscribers('owner/repo', 'v2.0.0')).rejects.toThrow(
      'SMTP connection refused',
    );
  });
});
