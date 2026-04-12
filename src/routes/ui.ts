import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FAVICON_PATH = join(__dirname, '../../public/favicon.svg');

export async function uiRoutes(app: FastifyInstance): Promise<void> {
  const favicon = await readFile(FAVICON_PATH);

  function sendView(_req: FastifyRequest, reply: FastifyReply): FastifyReply {
    return reply.view('pages/index.pug');
  }

  app.get('/favicon.svg', async (_req, reply) => {
    return reply
      .header('Content-Type', 'image/svg+xml')
      .header('Cache-Control', 'public, max-age=86400')
      .send(favicon);
  });

  app.get('/', sendView);
  app.get('/confirm/:token', sendView);
  app.get('/unsubscribe/:token', sendView);
}
