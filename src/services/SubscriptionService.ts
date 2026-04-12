import { randomUUID } from 'node:crypto';

import { eq, and } from 'drizzle-orm';

import { Db } from '../db/index.js';
import { subscriptions, repoStates } from '../db/schema.js';
import { BadRequestError, ConflictError, NotFoundError } from '../errors/index.js';
import { createGithubClient, GithubClient } from '../plugins/github.js';
import { Mailer } from '../plugins/mailer.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REPO_REGEX = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

export interface SubscriptionResponse {
  email: string;
  repo: string;
  confirmed: boolean;
  last_seen_tag: string | null;
}

export class SubscriptionService {
  constructor(
    private readonly db: Db,
    private readonly github: GithubClient,
    private readonly mailer: Mailer,
  ) {}

  async subscribe(email: string, repo: string, githubToken?: string): Promise<void> {
    if (!EMAIL_REGEX.test(email)) {
      throw new BadRequestError('Invalid email format');
    }
    if (!REPO_REGEX.test(repo)) {
      throw new BadRequestError('Invalid repo format. Expected owner/repo');
    }

    const github = githubToken ? createGithubClient(githubToken) : this.github;
    const [owner, repoName] = repo.split('/');
    const repoExists = await github.checkRepo(owner, repoName);
    if (!repoExists) {
      throw new NotFoundError('Repository not found on GitHub');
    }

    const existing = await this.db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(and(eq(subscriptions.email, email), eq(subscriptions.repo, repo)))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictError('Email already subscribed to this repository');
    }

    const token = randomUUID().replace(/-/g, '');

    await this.db.insert(subscriptions).values({
      email,
      repo,
      confirmed: false,
      token,
    });

    const existingRepoState = await this.db
      .select({ repo: repoStates.repo })
      .from(repoStates)
      .where(eq(repoStates.repo, repo))
      .limit(1);

    if (existingRepoState.length === 0) {
      const initialTag = await github.getLatestTag(owner, repoName);
      await this.db
        .insert(repoStates)
        .values({ repo, lastSeenTag: initialTag })
        .onConflictDoNothing();
    }

    await this.mailer.sendConfirmationEmail(email, token);
  }

  async confirm(token: string): Promise<void> {
    const rows = await this.db
      .select({ id: subscriptions.id, confirmed: subscriptions.confirmed })
      .from(subscriptions)
      .where(eq(subscriptions.token, token))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundError('Token not found');
    }

    if (rows[0].confirmed) {
      throw new BadRequestError('Subscription already confirmed');
    }

    await this.db
      .update(subscriptions)
      .set({ confirmed: true })
      .where(eq(subscriptions.token, token));
  }

  async unsubscribe(token: string): Promise<void> {
    const rows = await this.db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.token, token))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundError('Token not found');
    }

    await this.db.delete(subscriptions).where(eq(subscriptions.token, token));
  }

  async getSubscriptions(email: string): Promise<SubscriptionResponse[]> {
    if (!EMAIL_REGEX.test(email)) {
      throw new BadRequestError('Invalid email format');
    }

    const rows = await this.db
      .select({
        email: subscriptions.email,
        repo: subscriptions.repo,
        confirmed: subscriptions.confirmed,
        lastSeenTag: repoStates.lastSeenTag,
      })
      .from(subscriptions)
      .leftJoin(repoStates, eq(subscriptions.repo, repoStates.repo))
      .where(eq(subscriptions.email, email));

    return rows.map((row) => ({
      email: row.email,
      repo: row.repo,
      confirmed: row.confirmed,
      last_seen_tag: row.lastSeenTag ?? null,
    }));
  }
}
