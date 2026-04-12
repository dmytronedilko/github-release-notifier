import type { GithubClient } from './github.js';
import type { Redis } from './redis.js';

const TTL_SECONDS = 600;

export function withGithubCache(client: GithubClient, redis: Redis): GithubClient {
  return {
    async checkRepo(owner: string, repo: string): Promise<boolean> {
      const key = `gh:repo:${owner}/${repo}`;

      try {
        const cached = await redis.get(key);
        if (cached !== null) return cached === '1';
      } catch {}

      const result = await client.checkRepo(owner, repo);

      try {
        await redis.set(key, result ? '1' : '0', 'EX', TTL_SECONDS);
      } catch {}

      return result;
    },

    async getLatestTag(owner: string, repo: string): Promise<string | null> {
      const key = `gh:tag:${owner}/${repo}`;

      try {
        const cached = await redis.get(key);
        if (cached !== null) return JSON.parse(cached) as string | null;
      } catch {}

      const result = await client.getLatestTag(owner, repo);

      try {
        await redis.set(key, JSON.stringify(result), 'EX', TTL_SECONDS);
      } catch {}

      return result;
    },
  };
}
