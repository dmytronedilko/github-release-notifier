import crypto from 'node:crypto';

import { eq, and, gt } from 'drizzle-orm';

import type { Db } from '../db/index.js';
import { users, sessions } from '../db/schema.js';
import type { User } from '../db/schema.js';

const SESSION_TOKEN_BYTES = 32;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface GithubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GithubUser {
  id: number;
  login: string;
  avatar_url: string;
}

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
}

export class AuthService {
  private readonly baseUrl: string;

  constructor(
    private readonly db: Db,
    private readonly config: AuthConfig,
  ) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
  }

  /** Build the GitHub OAuth authorization URL. */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: `${this.baseUrl}/api/auth/github/callback`,
      scope: 'read:user',
      state,
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  /** Exchange authorization code for an access token. */
  async exchangeCode(code: string): Promise<string> {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: `${this.baseUrl}/api/auth/github/callback`,
      }),
    });

    const data = (await res.json()) as GithubTokenResponse;

    if (data.error || !data.access_token) {
      throw new Error(data.error_description ?? data.error ?? 'Failed to exchange code');
    }

    return data.access_token;
  }

  /** Fetch GitHub user profile using an access token. */
  async fetchGithubUser(accessToken: string): Promise<GithubUser> {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status}`);
    }

    return (await res.json()) as GithubUser;
  }

  /** Find existing user or create a new one from GitHub profile. */
  async findOrCreateUser(ghUser: GithubUser): Promise<User> {
    const existing = await this.db
      .select()
      .from(users)
      .where(eq(users.githubId, ghUser.id))
      .limit(1);

    if (existing.length > 0) {
      await this.db
        .update(users)
        .set({
          username: ghUser.login,
          avatarUrl: ghUser.avatar_url,
        })
        .where(eq(users.githubId, ghUser.id));

      return { ...existing[0], username: ghUser.login, avatarUrl: ghUser.avatar_url };
    }

    const [user] = await this.db
      .insert(users)
      .values({
        githubId: ghUser.id,
        username: ghUser.login,
        avatarUrl: ghUser.avatar_url,
      })
      .returning();

    return user;
  }

  /** Create a new session for a user. Returns the session token. */
  async createSession(userId: number): Promise<string> {
    const token = crypto.randomBytes(SESSION_TOKEN_BYTES).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.db.insert(sessions).values({
      token,
      userId,
      expiresAt,
    });

    return token;
  }

  /** Verify a session token. Returns the user if valid, null otherwise. */
  async verifySession(token: string): Promise<User | null> {
    const rows = await this.db
      .select({
        session: sessions,
        user: users,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    return rows[0].user;
  }

  /** Destroy a session. */
  async destroySession(token: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.token, token));
  }

  /** Generate a random state string for CSRF protection. */
  generateState(): string {
    return crypto.randomBytes(16).toString('hex');
  }
}
