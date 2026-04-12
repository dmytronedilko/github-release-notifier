import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createGithubClient } from '../plugins/github.js';

function mockResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const headerMap = new Headers(headers);
  return {
    status,
    headers: headerMap,
    json: () => Promise.resolve(body),
    ok: status >= 200 && status < 300,
  } as unknown as Response;
}

describe('GithubClient.checkRepo()', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true for a 200 response', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, {}));

    const client = createGithubClient();
    const result = await client.checkRepo('owner', 'repo');

    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo',
      expect.any(Object),
    );
  });

  it('returns false for a 404 response', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(404, {}));

    const client = createGithubClient();
    const result = await client.checkRepo('owner', 'nonexistent');

    expect(result).toBe(false);
  });

  it('throws for unexpected status codes', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(500, {}));

    const client = createGithubClient();
    await expect(client.checkRepo('owner', 'repo')).rejects.toThrow('GitHub API error: 500');
  });
});

describe('GithubClient.getLatestTag()', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns tag_name from releases/latest on 200', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse(200, { tag_name: 'v3.0.0' }));

    const client = createGithubClient();
    const tag = await client.getLatestTag('owner', 'repo');

    expect(tag).toBe('v3.0.0');
  });

  it('falls back to /tags when releases/latest returns 404 and returns first tag', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse(404, {}))
      .mockResolvedValueOnce(mockResponse(200, [{ name: 'v1.2.3' }, { name: 'v1.0.0' }]));

    const client = createGithubClient();
    const tag = await client.getLatestTag('owner', 'repo');

    expect(tag).toBe('v1.2.3');
  });

  it('returns null when releases/latest is 404 and tags list is empty', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse(404, {}))
      .mockResolvedValueOnce(mockResponse(200, []));

    const client = createGithubClient();
    const tag = await client.getLatestTag('owner', 'repo');

    expect(tag).toBeNull();
  });

  it('handles 429 with X-RateLimit-Reset header: sleeps until reset and retries', async () => {
    const resetTime = Math.floor(Date.now() / 1000) + 1;

    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse(429, {}, { 'x-ratelimit-reset': String(resetTime) }))
      .mockResolvedValueOnce(mockResponse(200, { tag_name: 'v4.0.0' }));

    const sleepSpy = vi.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void) => {
      cb();
      return 0;
    }) as typeof setTimeout);

    const client = createGithubClient();
    const tag = await client.getLatestTag('owner', 'repo');

    expect(tag).toBe('v4.0.0');
    expect(fetch).toHaveBeenCalledTimes(2);
    sleepSpy.mockRestore();
  });

  it('handles 429 without X-RateLimit-Reset header: uses exponential backoff', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse(429, {}))
      .mockResolvedValueOnce(mockResponse(200, { tag_name: 'v5.0.0' }));

    const sleepSpy = vi.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void) => {
      cb();
      return 0;
    }) as typeof setTimeout);

    const client = createGithubClient();
    const tag = await client.getLatestTag('owner', 'repo');

    expect(tag).toBe('v5.0.0');
    expect(fetch).toHaveBeenCalledTimes(2);
    sleepSpy.mockRestore();
  });
});
