import { StatusCodes } from 'http-status-codes';

import { ServiceUnavailableError, TooManyRequestsError } from '../errors/index.js';

const GITHUB_API_BASE = 'https://api.github.com';
const MAX_RETRIES = 3;

export interface GithubClient {
  checkRepo(owner: string, repo: string): Promise<boolean>;
  getLatestTag(owner: string, repo: string): Promise<string | null>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'github-release-notifier/1.0',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function fetchWithRateLimitRetry(
  url: string,
  headers: Record<string, string>,
  attempt = 0,
): Promise<Response> {
  const response = await fetch(url, { headers });

  if (response.status === StatusCodes.TOO_MANY_REQUESTS) {
    if (attempt >= MAX_RETRIES) {
      return response;
    }

    const resetHeader = response.headers.get('x-ratelimit-reset');
    let waitMs: number;

    if (resetHeader) {
      const resetTime = parseInt(resetHeader, 10) * 1000;
      waitMs = Math.max(resetTime - Date.now() + 500, 500);
    } else {
      waitMs = Math.pow(2, attempt) * 1000;
    }

    await sleep(waitMs);
    return fetchWithRateLimitRetry(url, headers, attempt + 1);
  }

  return response;
}

export function createGithubClient(token?: string): GithubClient {
  const headers = buildHeaders(token);

  return {
    async checkRepo(owner: string, repo: string): Promise<boolean> {
      const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}`;
      const response = await fetchWithRateLimitRetry(url, headers);
      if (response.status === StatusCodes.OK) return true;
      if (response.status === StatusCodes.NOT_FOUND) return false;
      if (
        response.status === StatusCodes.FORBIDDEN ||
        response.status === StatusCodes.TOO_MANY_REQUESTS
      ) {
        throw new TooManyRequestsError('GitHub API rate limit exceeded. Try again later');
      }
      throw new ServiceUnavailableError(`GitHub API error: ${response.status}`);
    },

    async getLatestTag(owner: string, repo: string): Promise<string | null> {
      const releaseUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/releases/latest`;
      const releaseResponse = await fetchWithRateLimitRetry(releaseUrl, headers);

      if (releaseResponse.status === StatusCodes.OK) {
        const data = (await releaseResponse.json()) as { tag_name: string };
        return data.tag_name;
      }

      if (releaseResponse.status === StatusCodes.NOT_FOUND) {
        const tagsUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/tags`;
        const tagsResponse = await fetchWithRateLimitRetry(tagsUrl, headers);

        if (tagsResponse.status === StatusCodes.OK) {
          const tags = (await tagsResponse.json()) as { name: string }[];
          return tags.length > 0 ? tags[0].name : null;
        }
        return null;
      }

      if (
        releaseResponse.status === StatusCodes.FORBIDDEN ||
        releaseResponse.status === StatusCodes.TOO_MANY_REQUESTS
      ) {
        throw new TooManyRequestsError('GitHub API rate limit exceeded. Try again later');
      }
      throw new ServiceUnavailableError(`GitHub API error: ${releaseResponse.status}`);
    },
  };
}
