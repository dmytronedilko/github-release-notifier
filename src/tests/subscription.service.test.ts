import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Db } from '../db/index.js';
import { BadRequestError, ConflictError, NotFoundError } from '../errors/index.js';
import type { GithubClient } from '../plugins/github.js';
import type { Mailer } from '../plugins/mailer.js';
import { SubscriptionService } from '../services/SubscriptionService.js';

import { makeGithub, makeMailer } from './helpers.js';

function makeMockDb() {
  const selectResult: unknown[] = [];
  const mockSelect = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(selectResult),
    leftJoin: vi.fn().mockReturnThis(),
  };

  return {
    select: vi.fn().mockReturnValue(mockSelect),
    selectDistinct: vi.fn().mockReturnValue(mockSelect),
    insert: vi.fn().mockImplementation(() => {
      const valuesResult = Promise.resolve(undefined) as Promise<undefined> & {
        onConflictDoNothing: ReturnType<typeof vi.fn>;
      };
      valuesResult.onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
      return { values: vi.fn().mockReturnValue(valuesResult) };
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    _mockSelectResult: selectResult,
    _mockSelect: mockSelect,
  };
}

type MockDb = ReturnType<typeof makeMockDb>;

describe('SubscriptionService.subscribe()', () => {
  let mockDb: MockDb;
  let github: GithubClient;
  let mailer: Mailer;
  let service: SubscriptionService;

  beforeEach(() => {
    mockDb = makeMockDb();
    github = makeGithub();
    mailer = makeMailer();
    service = new SubscriptionService(mockDb as unknown as Db, github, mailer);
  });

  it('successfully creates a subscription and seeds repo_states', async () => {
    mockDb._mockSelect.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await service.subscribe('user@example.com', 'owner/repo');

    expect(github.checkRepo).toHaveBeenCalledWith('owner', 'repo');
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
    expect(mailer.sendConfirmationEmail).toHaveBeenCalledOnce();
    expect(github.getLatestTag).toHaveBeenCalledWith('owner', 'repo');
  });

  it('does not re-seed repo_states when repo already exists', async () => {
    mockDb._mockSelect.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ repo: 'owner/repo' }]);

    await service.subscribe('user@example.com', 'owner/repo');

    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    expect(github.getLatestTag).not.toHaveBeenCalled();
  });

  it('throws 400 for invalid email format', async () => {
    await expect(service.subscribe('not-an-email', 'owner/repo')).rejects.toThrow(
      new BadRequestError('Invalid email format'),
    );
    expect(github.checkRepo).not.toHaveBeenCalled();
  });

  it('throws 400 for invalid repo format (no slash)', async () => {
    await expect(service.subscribe('user@example.com', 'invalidrepo')).rejects.toThrow(
      new BadRequestError('Invalid repo format. Expected owner/repo'),
    );
  });

  it('throws 400 for invalid repo format (too many parts)', async () => {
    await expect(service.subscribe('user@example.com', 'a/b/c')).rejects.toThrow(
      new BadRequestError('Invalid repo format. Expected owner/repo'),
    );
  });

  it('throws 404 when GitHub repo does not exist', async () => {
    (github.checkRepo as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    await expect(service.subscribe('user@example.com', 'owner/repo')).rejects.toThrow(
      new NotFoundError('Repository not found on GitHub'),
    );
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('throws 409 for duplicate subscription', async () => {
    mockDb._mockSelect.limit.mockResolvedValueOnce([{ id: 1 }]);

    await expect(service.subscribe('user@example.com', 'owner/repo')).rejects.toThrow(
      new ConflictError('Email already subscribed to this repository'),
    );
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('propagates DB error on insert', async () => {
    mockDb._mockSelect.limit.mockResolvedValueOnce([]);
    const dbError = new Error('DB connection lost');
    mockDb.insert.mockReturnValue({ values: vi.fn().mockRejectedValue(dbError) });

    await expect(service.subscribe('user@example.com', 'owner/repo')).rejects.toThrow(
      'DB connection lost',
    );
  });
});

describe('SubscriptionService.confirm()', () => {
  let mockDb: MockDb;
  let service: SubscriptionService;

  beforeEach(() => {
    mockDb = makeMockDb();
    service = new SubscriptionService(mockDb as unknown as Db, makeGithub(), makeMailer());
  });

  it('confirms a pending subscription', async () => {
    mockDb._mockSelect.limit.mockResolvedValueOnce([{ id: 1, confirmed: false }]);

    await service.confirm('some-token');

    expect(mockDb.update).toHaveBeenCalledOnce();
  });

  it('throws 404 when token not found', async () => {
    mockDb._mockSelect.limit.mockResolvedValueOnce([]);

    await expect(service.confirm('bad-token')).rejects.toThrow(
      new NotFoundError('Token not found'),
    );
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('throws 400 when subscription already confirmed', async () => {
    mockDb._mockSelect.limit.mockResolvedValueOnce([{ id: 1, confirmed: true }]);

    await expect(service.confirm('some-token')).rejects.toThrow(
      new BadRequestError('Subscription already confirmed'),
    );
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});

describe('SubscriptionService.unsubscribe()', () => {
  let mockDb: MockDb;
  let service: SubscriptionService;

  beforeEach(() => {
    mockDb = makeMockDb();
    service = new SubscriptionService(mockDb as unknown as Db, makeGithub(), makeMailer());
  });

  it('deletes the subscription', async () => {
    mockDb._mockSelect.limit.mockResolvedValueOnce([{ id: 1 }]);

    await service.unsubscribe('some-token');

    expect(mockDb.delete).toHaveBeenCalledOnce();
  });

  it('throws 404 when token not found', async () => {
    mockDb._mockSelect.limit.mockResolvedValueOnce([]);

    await expect(service.unsubscribe('bad-token')).rejects.toThrow(
      new NotFoundError('Token not found'),
    );
    expect(mockDb.delete).not.toHaveBeenCalled();
  });
});

describe('SubscriptionService.getSubscriptions()', () => {
  let mockDb: MockDb;
  let service: SubscriptionService;

  beforeEach(() => {
    mockDb = makeMockDb();
    service = new SubscriptionService(mockDb as unknown as Db, makeGithub(), makeMailer());
  });

  it('returns subscriptions with last_seen_tag', async () => {
    const rows = [{ email: 'u@e.com', repo: 'owner/repo', confirmed: true, lastSeenTag: 'v2.0.0' }];
    mockDb._mockSelect.limit.mockResolvedValueOnce(rows);
    mockDb._mockSelect.where.mockResolvedValueOnce(rows);

    const result = await service.getSubscriptions('u@e.com');

    expect(result).toEqual([
      { email: 'u@e.com', repo: 'owner/repo', confirmed: true, last_seen_tag: 'v2.0.0' },
    ]);
  });

  it('returns null last_seen_tag when repo has no releases yet', async () => {
    const rows = [{ email: 'u@e.com', repo: 'owner/repo', confirmed: false, lastSeenTag: null }];
    mockDb._mockSelect.where.mockResolvedValueOnce(rows);

    const result = await service.getSubscriptions('u@e.com');

    expect(result[0].last_seen_tag).toBeNull();
  });

  it('throws 400 for invalid email', async () => {
    await expect(service.getSubscriptions('not-an-email')).rejects.toThrow(
      new BadRequestError('Invalid email format'),
    );
  });
});
