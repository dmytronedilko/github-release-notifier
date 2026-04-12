import { eq, and } from 'drizzle-orm';

import type { Db } from '../db/index.js';
import { githubTokens } from '../db/schema.js';

const TOKEN_HINT_LENGTH = 8;

export interface GithubTokenInfo {
  id: number;
  name: string;
  tokenHint: string;
  createdAt: Date;
}

export class GithubTokenService {
  constructor(private db: Db) {}

  async addToken(userId: number, name: string, token: string): Promise<GithubTokenInfo> {
    const tokenHint = token.slice(-TOKEN_HINT_LENGTH);

    const [row] = await this.db
      .insert(githubTokens)
      .values({ name, token, tokenHint, userId })
      .returning({
        id: githubTokens.id,
        name: githubTokens.name,
        tokenHint: githubTokens.tokenHint,
        createdAt: githubTokens.createdAt,
      });

    return row;
  }

  async listTokens(userId: number): Promise<GithubTokenInfo[]> {
    return this.db
      .select({
        id: githubTokens.id,
        name: githubTokens.name,
        tokenHint: githubTokens.tokenHint,
        createdAt: githubTokens.createdAt,
      })
      .from(githubTokens)
      .where(eq(githubTokens.userId, userId));
  }

  async deleteToken(id: number, userId: number): Promise<boolean> {
    const rows = await this.db
      .select({ id: githubTokens.id })
      .from(githubTokens)
      .where(and(eq(githubTokens.id, id), eq(githubTokens.userId, userId)))
      .limit(1);

    if (rows.length === 0) {
      return false;
    }

    await this.db.delete(githubTokens).where(eq(githubTokens.id, id));
    return true;
  }

  async getTokenValue(id: number, userId: number): Promise<string | null> {
    const rows = await this.db
      .select({ token: githubTokens.token })
      .from(githubTokens)
      .where(and(eq(githubTokens.id, id), eq(githubTokens.userId, userId)))
      .limit(1);

    return rows.length > 0 ? rows[0].token : null;
  }
}
