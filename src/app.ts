import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import view from '@fastify/view';
import Fastify, { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { StatusCodes, getReasonPhrase } from 'http-status-codes';
import pug from 'pug';

import type { User } from './db/schema.js';
import { loggerOptions } from './logger.js';
import { httpRequestDurationSeconds, httpRequestsTotal } from './metrics.js';
import { apiKeyAuth } from './plugins/apiKeyAuth.js';
import { sessionAuth } from './plugins/sessionAuth.js';
import { authRoutes } from './routes/auth.js';
import { metricsRoute } from './routes/metrics.js';
import { subscriptionRoutes } from './routes/subscription.js';
import { uiRoutes } from './routes/ui.js';
import { ApiKeyService } from './services/ApiKeyService.js';
import { AuthService } from './services/AuthService.js';
import { GithubTokenService } from './services/GithubTokenService.js';
import { SubscriptionService } from './services/SubscriptionService.js';

declare module 'fastify' {
  interface FastifyInstance {
    subscriptionService: SubscriptionService;
    apiKeyService: ApiKeyService;
    authService: AuthService;
    githubTokenService: GithubTokenService;
    verifyApiKey: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    startTime: bigint;
    apiKeyVerified?: boolean;
    apiKeyUserId?: number;
    user: User | null;
  }
}

export interface AppConfig {
  subscriptionService: SubscriptionService;
  apiKeyService: ApiKeyService;
  authService: AuthService;
  githubTokenService: GithubTokenService;
  trustProxy?: boolean | string | number;
}

function isFastifyError(err: unknown): err is FastifyError {
  return typeof err === 'object' && err !== null && 'statusCode' in err;
}

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    trustProxy: config.trustProxy ?? false,
  });

  const __dirname = dirname(fileURLToPath(import.meta.url));

  await app.register(formbody);
  await app.register(cookie);
  await app.register(view, {
    engine: { pug },
    root: join(__dirname, '../views'),
  });

  app.decorate('subscriptionService', config.subscriptionService);
  app.decorate('apiKeyService', config.apiKeyService);
  app.decorate('authService', config.authService);
  app.decorate('githubTokenService', config.githubTokenService);
  app.decorateRequest('startTime', 0n);

  await app.register(apiKeyAuth);
  await app.register(sessionAuth);

  app.addHook('onRequest', (request, reply, done) => {
    const normalized = request.url.replace(/\/{2,}/g, '/');
    if (normalized !== request.url) {
      reply.redirect(StatusCodes.MOVED_PERMANENTLY, normalized);
      return;
    }
    request.startTime = process.hrtime.bigint();
    done();
  });

  app.addHook('onResponse', (request, reply, done) => {
    const route = request.routeOptions.url ?? request.url;
    const labels = {
      method: request.method,
      route,
      status_code: String(reply.statusCode),
    };
    httpRequestsTotal.inc(labels);
    const durationMs = Number(process.hrtime.bigint() - request.startTime) / 1e9;
    httpRequestDurationSeconds.observe(labels, durationMs);
    done();
  });

  app.setErrorHandler(
    (error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) => {
      const statusCode = isFastifyError(error) ? error.statusCode : undefined;
      if (statusCode !== undefined && statusCode < (StatusCodes.INTERNAL_SERVER_ERROR as number)) {
        return reply.status(statusCode).send({ error: error.message });
      }

      request.log.error(error);
      return reply
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send({ error: getReasonPhrase(StatusCodes.INTERNAL_SERVER_ERROR) });
    },
  );

  app.get('/health', async (_request, reply) => {
    return reply.status(StatusCodes.OK).send({ status: 'ok' });
  });

  await app.register(uiRoutes);
  await app.register(metricsRoute);
  await app.register(subscriptionRoutes, { prefix: '/api' });
  await app.register(authRoutes, { prefix: '/api' });

  return app;
}
