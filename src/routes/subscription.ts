import { FastifyInstance } from 'fastify';
import { StatusCodes } from 'http-status-codes';

import { subscribeSchema, tokenParamsSchema, subscriptionsQuerySchema } from './schemas.js';

interface SubscribeBody {
  email: string;
  repo: string;
}

interface TokenParams {
  token: string;
}

interface SubscriptionsQuery {
  email: string;
}

export async function subscriptionRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: SubscribeBody }>(
    '/subscribe',
    { schema: subscribeSchema, preHandler: [app.verifyApiKey] },
    async (request, reply) => {
      const { email, repo } = request.body;

      let githubToken: string | undefined;
      if (request.apiKeyUserId) {
        const tokens = await app.githubTokenService.listTokens(request.apiKeyUserId);
        if (tokens.length > 0) {
          githubToken =
            (await app.githubTokenService.getTokenValue(tokens[0].id, request.apiKeyUserId)) ??
            undefined;
        }
      }

      await app.subscriptionService.subscribe(email, repo, githubToken);
      return reply
        .status(StatusCodes.OK)
        .send({ message: 'Subscription successful. Confirmation email sent.' });
    },
  );

  app.get<{ Params: TokenParams }>(
    '/confirm/:token',
    { schema: tokenParamsSchema },
    async (request, reply) => {
      await app.subscriptionService.confirm(request.params.token);
      return reply.status(StatusCodes.OK).send({ message: 'Subscription confirmed successfully.' });
    },
  );

  app.get<{ Params: TokenParams }>(
    '/unsubscribe/:token',
    { schema: tokenParamsSchema },
    async (request, reply) => {
      await app.subscriptionService.unsubscribe(request.params.token);
      return reply.status(StatusCodes.OK).send({ message: 'Unsubscribed successfully.' });
    },
  );

  app.get<{ Querystring: SubscriptionsQuery }>(
    '/subscriptions',
    { schema: subscriptionsQuerySchema, preHandler: [app.verifyApiKey] },
    async (request, reply) => {
      const result = await app.subscriptionService.getSubscriptions(request.query.email);
      return reply.status(StatusCodes.OK).send(result);
    },
  );
}
