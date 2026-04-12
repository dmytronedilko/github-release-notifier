import 'dotenv/config';

import cron from 'node-cron';

import { buildApp } from './app.js';
import { initDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { createGrpcServer } from './grpc/server.js';
import { logger } from './logger.js';
import { createGithubClient } from './plugins/github.js';
import { withGithubCache } from './plugins/githubCache.js';
import { createMailer, createMockMailer } from './plugins/mailer.js';
import { createRedisClient, closeRedisClient } from './plugins/redis.js';
import { ApiKeyService } from './services/ApiKeyService.js';
import { AuthService } from './services/AuthService.js';
import { GithubTokenService } from './services/GithubTokenService.js';
import { NotifierService } from './services/NotifierService.js';
import { ScannerService } from './services/ScannerService.js';
import { SubscriptionService } from './services/SubscriptionService.js';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  logger.info('Running database migrations...');
  await runMigrations(databaseUrl);
  logger.info('Migrations complete.');

  const { db, close: closeDb } = initDb(databaseUrl);

  const baseGithub = createGithubClient();
  const redis = process.env.REDIS_URL ? createRedisClient(process.env.REDIS_URL) : null;
  const github = redis ? withGithubCache(baseGithub, redis) : baseGithub;

  const mailerConfig = {
    apiKey: process.env.BREVO_API_KEY ?? '',
    senderName: process.env.BREVO_SENDER_NAME ?? 'GitHub Release Notifier',
    senderEmail: process.env.BREVO_SENDER_EMAIL ?? 'noreply@localhost',
    baseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
  };

  const mailer = process.env.BREVO_API_KEY ? createMailer(mailerConfig) : createMockMailer();

  const subscriptionService = new SubscriptionService(db, github, mailer);
  const apiKeyService = new ApiKeyService(db);
  const githubTokenService = new GithubTokenService(db);
  const authService = new AuthService(db, {
    clientId: process.env.GITHUB_CLIENT_ID ?? '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
    baseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
  });
  const notifierService = new NotifierService(db, mailer);
  const scannerService = new ScannerService(db, baseGithub, notifierService);

  const trustProxy = process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1';
  const app = await buildApp({
    subscriptionService,
    apiKeyService,
    authService,
    githubTokenService,
    trustProxy,
  });

  const scanCron = process.env.SCAN_CRON ?? '*/5 * * * *';
  let isScanning = false;
  const cronTask = cron.schedule(scanCron, () => {
    if (isScanning) {
      logger.warn('Previous scan still running, skipping this tick');
      return;
    }
    isScanning = true;
    logger.info('Starting scan...');
    scannerService
      .scan()
      .then(() => {
        logger.info('Scan complete.');
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, 'Error during scan');
      })
      .finally(() => {
        isScanning = false;
      });
  });

  logger.info({ scanCron }, 'Scanner cron scheduled');

  const grpcServer = createGrpcServer(subscriptionService);
  const grpcPort = parseInt(process.env.GRPC_PORT ?? '50051', 10);
  const boundGrpcPort = await grpcServer.start(grpcPort);
  logger.info({ grpcPort: boundGrpcPort }, 'gRPC server started');

  app.addHook('onClose', async () => {
    cronTask.stop();
    await grpcServer.stop();
    if (redis) await closeRedisClient(redis);
    await closeDb();
    logger.info('Cleanup complete');
  });

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen({ port, host: '0.0.0.0' });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      logger.info({ signal }, 'Received signal, shutting down…');
      app
        .close()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
  }
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Fatal error');
  process.exit(1);
});
