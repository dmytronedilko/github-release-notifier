import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

import { UnauthorizedError } from '../errors/index.js';

const API_KEY_HEADER = 'x-api-key';

export const apiKeyAuth = fp(
  async (app: FastifyInstance): Promise<void> => {
    app.decorateRequest('apiKeyVerified', false);
    app.decorateRequest('apiKeyUserId', 0);

    app.decorate('verifyApiKey', async (request: FastifyRequest, _reply: FastifyReply) => {
      const rawKey = request.headers[API_KEY_HEADER];

      if (typeof rawKey !== 'string' || rawKey.length === 0) {
        throw new UnauthorizedError('Missing API key');
      }

      const userId = await app.apiKeyService.verifyKey(rawKey);
      if (userId === null) {
        throw new UnauthorizedError('Invalid or expired API key');
      }

      request.apiKeyVerified = true;
      request.apiKeyUserId = userId;
    });
  },
  { name: 'apiKeyAuth' },
);
