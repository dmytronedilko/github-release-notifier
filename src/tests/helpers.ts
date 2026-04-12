import { vi } from 'vitest';

import type { GithubClient } from '../plugins/github.js';
import type { Mailer } from '../plugins/mailer.js';

export function makeGithub(overrides: Partial<GithubClient> = {}): GithubClient {
  return {
    checkRepo: vi.fn().mockResolvedValue(true),
    getLatestTag: vi.fn().mockResolvedValue('v1.0.0'),
    ...overrides,
  };
}

export function makeGithubWithTags(tags: Record<string, string | null>): GithubClient {
  return {
    checkRepo: vi.fn().mockResolvedValue(true),
    getLatestTag: vi
      .fn()
      .mockImplementation((owner: string, repo: string) =>
        Promise.resolve(tags[`${owner}/${repo}`] ?? null),
      ),
  };
}

export function makeMailer(overrides: Partial<Mailer> = {}): Mailer {
  return {
    sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
    sendReleaseEmail: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
