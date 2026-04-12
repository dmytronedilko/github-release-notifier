import { FastifyInstance } from 'fastify';

import { registry } from '../metrics.js';

export async function metricsRoute(app: FastifyInstance): Promise<void> {
  app.get('/metrics', async (_request, reply) => {
    const metrics = await registry.metrics();
    return reply.header('Content-Type', registry.contentType).send(metrics);
  });
}
