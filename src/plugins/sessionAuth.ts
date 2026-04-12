import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

import { UnauthorizedError } from '../errors/index.js';

const SESSION_COOKIE = 'session';

export const sessionAuth = fp(
  async (app: FastifyInstance): Promise<void> => {
    app.decorateRequest('user', null);

    app.addHook('onRequest', async (request: FastifyRequest) => {
      const token = request.cookies[SESSION_COOKIE];
      if (!token) return;

      const user = await app.authService.verifySession(token);
      if (user) {
        request.user = user;
      }
    });

    app.decorate('requireAuth', async (request: FastifyRequest, _reply: FastifyReply) => {
      if (!request.user) {
        throw new UnauthorizedError('Authentication required. Please log in with GitHub.');
      }
    });
  },
  { name: 'sessionAuth', dependencies: ['@fastify/cookie'] },
);
