import { FastifyInstance } from 'fastify';
import { StatusCodes } from 'http-status-codes';

import { TooManyRequestsError } from '../errors/index.js';

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const SESSION_COOKIE = 'session';
const OAUTH_STATE_COOKIE = 'oauth_state';
const COOKIE_MAX_AGE_S = 7 * 24 * 60 * 60;

const ipRequestLog = new Map<string, number[]>();
let lastCleanup = Date.now();

function cleanupStaleEntries(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [ip, timestamps] of ipRequestLog) {
    const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length === 0) {
      ipRequestLog.delete(ip);
    } else {
      ipRequestLog.set(ip, recent);
    }
  }
}

function isRateLimited(ip: string): boolean {
  cleanupStaleEntries();

  const now = Date.now();
  const timestamps = ipRequestLog.get(ip) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  ipRequestLog.set(ip, recent);

  if (recent.length >= RATE_LIMIT_MAX) {
    return true;
  }

  recent.push(now);
  return false;
}

interface GenerateBody {
  name?: string;
  expiresAt?: string;
}

interface GithubTokenBody {
  name?: string;
  token: string;
}

interface DeleteParams {
  id: string;
}

interface CallbackQuery {
  code?: string;
  state?: string;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/auth/github', async (request, reply) => {
    const state = app.authService.generateState();

    reply.setCookie(OAUTH_STATE_COOKIE, state, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 300,
    });

    const url = app.authService.getAuthorizationUrl(state);
    return reply.redirect(url);
  });

  app.get<{ Querystring: CallbackQuery }>('/auth/github/callback', async (request, reply) => {
    const { code, state } = request.query;
    const savedState = request.cookies[OAUTH_STATE_COOKIE];

    reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });

    if (!code || !state || state !== savedState) {
      return reply.status(StatusCodes.BAD_REQUEST).send({ error: 'Invalid OAuth state.' });
    }

    try {
      const accessToken = await app.authService.exchangeCode(code);
      const ghUser = await app.authService.fetchGithubUser(accessToken);
      const user = await app.authService.findOrCreateUser(ghUser);
      const sessionToken = await app.authService.createSession(user.id);

      reply.setCookie(SESSION_COOKIE, sessionToken, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: COOKIE_MAX_AGE_S,
      });

      return await reply.redirect('/?tab=apikey');
    } catch (error) {
      request.log.error(error, 'OAuth callback failed');
      return reply.redirect('/?auth_error=1');
    }
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];

    if (token) {
      await app.authService.destroySession(token);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
    }

    return reply.send({ message: 'Logged out.' });
  });

  app.get('/auth/me', async (request, reply) => {
    if (!request.user) {
      return reply.status(StatusCodes.UNAUTHORIZED).send({ error: 'Not authenticated.' });
    }

    return reply.send({
      id: request.user.id,
      username: request.user.username,
      avatarUrl: request.user.avatarUrl,
    });
  });

  app.post<{ Body: GenerateBody }>(
    '/auth/generate',
    {
      preHandler: [app.requireAuth],
      schema: {
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', maxLength: 255 },
            expiresAt: { type: 'string', format: 'date-time' },
          },
          additionalProperties: false,
        },
        response: {
          [StatusCodes.CREATED]: {
            type: 'object',
            properties: {
              apiKey: { type: 'string' },
              message: { type: 'string' },
            },
          },
          [StatusCodes.TOO_MANY_REQUESTS]: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const ip = request.ip;

      if (isRateLimited(ip)) {
        throw new TooManyRequestsError('Rate limit exceeded. Try again later.');
      }

      const user = request.user;
      if (!user) return;

      const { name, expiresAt } = request.body;

      const rawKey = await app.apiKeyService.generateKey({
        name: name?.trim() ?? 'Unnamed key',
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        userId: user.id,
      });

      return reply.status(StatusCodes.CREATED).send({
        apiKey: rawKey,
        message: 'Store this key securely. It will not be shown again.',
      });
    },
  );

  app.get(
    '/auth/keys',
    {
      preHandler: [app.requireAuth],
      schema: {
        response: {
          [StatusCodes.OK]: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number' },
                name: { type: 'string' },
                keyHint: { type: 'string' },
                createdAt: { type: 'string' },
                expiresAt: { type: ['string', 'null'] },
                lastUsedAt: { type: ['string', 'null'] },
                usageCount: { type: 'number' },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user;
      if (!user) return;
      const keys = await app.apiKeyService.listKeys(user.id);
      return reply.send(keys);
    },
  );

  app.delete<{ Params: DeleteParams }>(
    '/auth/keys/:id',
    {
      preHandler: [app.requireAuth],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', pattern: '^\\d+$' },
          },
        },
        response: {
          [StatusCodes.OK]: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
          },
          [StatusCodes.NOT_FOUND]: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user;
      if (!user) return;
      const id = parseInt(request.params.id, 10);
      const deleted = await app.apiKeyService.deleteKey(id, user.id);

      if (!deleted) {
        return reply.status(StatusCodes.NOT_FOUND).send({ error: 'Key not found.' });
      }

      return reply.send({ message: 'API key deleted.' });
    },
  );

  app.post<{ Body: GithubTokenBody }>(
    '/auth/github-tokens',
    {
      preHandler: [app.requireAuth],
      schema: {
        body: {
          type: 'object',
          required: ['token'],
          properties: {
            name: { type: 'string', maxLength: 255 },
            token: { type: 'string', minLength: 1, maxLength: 500 },
          },
          additionalProperties: false,
        },
        response: {
          [StatusCodes.CREATED]: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              tokenHint: { type: 'string' },
              createdAt: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user;
      if (!user) return;
      const { name, token } = request.body;

      const result = await app.githubTokenService.addToken(
        user.id,
        name?.trim() ?? 'Unnamed token',
        token,
      );

      return reply.status(StatusCodes.CREATED).send(result);
    },
  );

  app.get(
    '/auth/github-tokens',
    {
      preHandler: [app.requireAuth],
      schema: {
        response: {
          [StatusCodes.OK]: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number' },
                name: { type: 'string' },
                tokenHint: { type: 'string' },
                createdAt: { type: 'string' },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user;
      if (!user) return;
      const tokens = await app.githubTokenService.listTokens(user.id);
      return reply.send(tokens);
    },
  );

  app.delete<{ Params: DeleteParams }>(
    '/auth/github-tokens/:id',
    {
      preHandler: [app.requireAuth],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', pattern: '^\\d+$' },
          },
        },
        response: {
          [StatusCodes.OK]: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
          },
          [StatusCodes.NOT_FOUND]: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user;
      if (!user) return;
      const id = parseInt(request.params.id, 10);
      const deleted = await app.githubTokenService.deleteToken(id, user.id);

      if (!deleted) {
        return reply.status(StatusCodes.NOT_FOUND).send({ error: 'Token not found.' });
      }

      return reply.send({ message: 'GitHub token deleted.' });
    },
  );
}
