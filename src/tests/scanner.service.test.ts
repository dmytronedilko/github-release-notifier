import { describe, it, expect, vi } from 'vitest';

import type { Db } from '../db/index.js';
import type { Notifier } from '../services/NotifierService.js';
import { ScannerService } from '../services/ScannerService.js';

import { makeGithubWithTags } from './helpers.js';

function makeMockDb(confirmedRepos: string[], repoStateTags: Record<string, string | null>) {
  const selectDistinctResult = confirmedRepos.map((repo) => ({ repo }));

  const mockSelectDistinctChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(selectDistinctResult),
  };

  let repoStateCallCount = 0;
  const repoStateKeys = Object.keys(repoStateTags);

  const mockSelectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockImplementation(() => {
      const repo = repoStateKeys[repoStateCallCount] ?? repoStateKeys[0];
      const tag = repoStateTags[repo];
      repoStateCallCount++;
      if (tag === null) return Promise.resolve([]);
      return Promise.resolve([{ lastSeenTag: tag }]);
    }),
  };

  const mockUpsertChain = {
    values: vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    }),
  };

  return {
    selectDistinct: vi.fn().mockReturnValue(mockSelectDistinctChain),
    select: vi.fn().mockReturnValue(mockSelectChain),
    insert: vi.fn().mockReturnValue(mockUpsertChain),
    _mockUpsert: mockUpsertChain,
  };
}

function makeNotifier(): Notifier {
  return {
    notifySubscribers: vi.fn().mockResolvedValue(undefined),
  } as unknown as Notifier;
}

describe('ScannerService.scan()', () => {
  it('detects a new release and notifies subscribers', async () => {
    const db = makeMockDb(['owner/repo'], { 'owner/repo': 'v1.0.0' });
    const github = makeGithubWithTags({ 'owner/repo': 'v2.0.0' });
    const notifier = makeNotifier();
    const scanner = new ScannerService(db as unknown as Db, github, notifier);

    await scanner.scan();

    expect(github.getLatestTag).toHaveBeenCalledWith('owner', 'repo');
    expect(db.insert).toHaveBeenCalledOnce();
    expect(notifier.notifySubscribers).toHaveBeenCalledWith('owner/repo', 'v2.0.0');
  });

  it('does not notify when tag has not changed', async () => {
    const db = makeMockDb(['owner/repo'], { 'owner/repo': 'v1.0.0' });
    const github = makeGithubWithTags({ 'owner/repo': 'v1.0.0' });
    const notifier = makeNotifier();
    const scanner = new ScannerService(db as unknown as Db, github, notifier);

    await scanner.scan();

    expect(db.insert).not.toHaveBeenCalled();
    expect(notifier.notifySubscribers).not.toHaveBeenCalled();
  });

  it('skips repo when there are no releases (null tag)', async () => {
    const db = makeMockDb(['owner/repo'], { 'owner/repo': null });
    const github = makeGithubWithTags({ 'owner/repo': null });
    const notifier = makeNotifier();
    const scanner = new ScannerService(db as unknown as Db, github, notifier);

    await scanner.scan();

    expect(db.insert).not.toHaveBeenCalled();
    expect(notifier.notifySubscribers).not.toHaveBeenCalled();
  });

  it('handles multiple repos independently', async () => {
    const db = makeMockDb(['owner/repo1', 'owner/repo2'], {
      'owner/repo1': 'v1.0.0',
      'owner/repo2': 'v3.0.0',
    });

    const github = makeGithubWithTags({
      'owner/repo1': 'v2.0.0',
      'owner/repo2': 'v3.0.0',
    });

    const notifier = makeNotifier();
    const scanner = new ScannerService(db as unknown as Db, github, notifier);

    await scanner.scan();

    expect(notifier.notifySubscribers).toHaveBeenCalledOnce();
    expect(notifier.notifySubscribers).toHaveBeenCalledWith('owner/repo1', 'v2.0.0');
    expect(db.insert).toHaveBeenCalledOnce();
  });
});
