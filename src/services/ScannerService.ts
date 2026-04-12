import { eq, sql } from 'drizzle-orm';

import type { Db } from '../db/index.js';
import { subscriptions, repoStates } from '../db/schema.js';
import { scanRunsTotal } from '../metrics.js';
import type { GithubClient } from '../plugins/github.js';

import type { Notifier } from './NotifierService.js';

const SCAN_CONCURRENCY = 5;

export class ScannerService {
  constructor(
    private readonly db: Db,
    private readonly github: GithubClient,
    private readonly notifier: Notifier,
  ) {}

  async scan(): Promise<void> {
    try {
      const confirmedRepos = await this.db
        .selectDistinct({ repo: subscriptions.repo })
        .from(subscriptions)
        .where(eq(subscriptions.confirmed, true));

      for (let i = 0; i < confirmedRepos.length; i += SCAN_CONCURRENCY) {
        const batch = confirmedRepos.slice(i, i + SCAN_CONCURRENCY);
        await Promise.all(batch.map(({ repo }) => this.scanRepo(repo)));
      }
      scanRunsTotal.inc({ result: 'success' });
    } catch (err: unknown) {
      scanRunsTotal.inc({ result: 'error' });
      throw err;
    }
  }

  private async scanRepo(repo: string): Promise<void> {
    const [owner, repoName] = repo.split('/');

    const newTag = await this.github.getLatestTag(owner, repoName);
    if (newTag === null) {
      return;
    }

    const stateRows = await this.db
      .select({ lastSeenTag: repoStates.lastSeenTag })
      .from(repoStates)
      .where(eq(repoStates.repo, repo))
      .limit(1);

    const lastSeenTag = stateRows.length > 0 ? stateRows[0].lastSeenTag : null;

    if (newTag === lastSeenTag) {
      return;
    }

    await this.db
      .insert(repoStates)
      .values({ repo, lastSeenTag: newTag })
      .onConflictDoUpdate({
        target: repoStates.repo,
        set: { lastSeenTag: newTag, lastChecked: sql`now()` },
      });

    await this.notifier.notifySubscribers(repo, newTag);
  }
}
