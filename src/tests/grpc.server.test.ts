import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

import type { Db } from '../db/index.js';
import { createGrpcServer, type GrpcServerHandle } from '../grpc/server.js';
import { SubscriptionService } from '../services/SubscriptionService.js';

import { makeGithub, makeMailer } from './helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = resolve(__dirname, '../../proto/notifier.proto');

function makeMockDb() {
  const selectResult: unknown[] = [];
  const mockSelect = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(selectResult),
    leftJoin: vi.fn().mockReturnThis(),
  };

  return {
    select: vi.fn().mockReturnValue(mockSelect),
    selectDistinct: vi.fn().mockReturnValue(mockSelect),
    insert: vi.fn().mockImplementation(() => {
      const valuesResult = Promise.resolve(undefined) as Promise<undefined> & {
        onConflictDoNothing: ReturnType<typeof vi.fn>;
      };
      valuesResult.onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
      return { values: vi.fn().mockReturnValue(valuesResult) };
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    _mockSelect: mockSelect,
  };
}

interface GrpcSubscription {
  email: string;
  repo: string;
  confirmed: boolean;
  last_seen_tag: string;
}

interface GrpcClient {
  Subscribe: (
    req: { email: string; repo: string },
    cb: (err: grpc.ServiceError | null, res?: { message: string }) => void,
  ) => void;
  Confirm: (
    req: { token: string },
    cb: (err: grpc.ServiceError | null, res?: { message: string }) => void,
  ) => void;
  Unsubscribe: (
    req: { token: string },
    cb: (err: grpc.ServiceError | null, res?: { message: string }) => void,
  ) => void;
  GetSubscriptions: (
    req: { email: string },
    cb: (
      err: grpc.ServiceError | null,
      res?: {
        subscriptions: GrpcSubscription[];
      },
    ) => void,
  ) => void;
}

function loadClient(port: number): GrpcClient {
  const packageDef = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(packageDef) as Record<string, unknown>;
  const notifierPkg = proto.notifier as { NotifierService: new (...args: unknown[]) => GrpcClient };
  return new notifierPkg.NotifierService(`localhost:${port}`, grpc.credentials.createInsecure());
}

describe('gRPC NotifierService', () => {
  let grpcHandle: GrpcServerHandle;
  let client: GrpcClient;
  let mockDb: ReturnType<typeof makeMockDb>;
  let service: SubscriptionService;

  beforeAll(async () => {
    mockDb = makeMockDb();
    service = new SubscriptionService(mockDb as unknown as Db, makeGithub(), makeMailer());
    grpcHandle = createGrpcServer(service);
    const port = await grpcHandle.start(0); // random port
    client = loadClient(port);
  });

  afterAll(async () => {
    await grpcHandle.stop();
  });

  describe('Subscribe', () => {
    it('returns success message on valid subscription', async () => {
      mockDb._mockSelect.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const result = await new Promise<{ message: string }>((resolve, reject) => {
        client.Subscribe({ email: 'user@example.com', repo: 'owner/repo' }, (err, res) => {
          if (err) reject(err);
          else resolve(res!);
        });
      });

      expect(result.message).toBe('Subscription successful. Confirmation email sent.');
    });

    it('returns INVALID_ARGUMENT for invalid email', async () => {
      const err = await new Promise<grpc.ServiceError>((resolve) => {
        client.Subscribe({ email: 'bad', repo: 'owner/repo' }, (err) => {
          resolve(err!);
        });
      });

      expect(err.code).toBe(grpc.status.INVALID_ARGUMENT);
      expect(err.details).toContain('Invalid email format');
    });

    it('returns NOT_FOUND for nonexistent repo', async () => {
      const github = makeGithub({ checkRepo: vi.fn().mockResolvedValue(false) });
      const svc = new SubscriptionService(mockDb as unknown as Db, github, makeMailer());
      const handle = createGrpcServer(svc);
      const port = await handle.start(0);
      const c = loadClient(port);

      const err = await new Promise<grpc.ServiceError>((resolve) => {
        c.Subscribe({ email: 'user@example.com', repo: 'owner/repo' }, (err) => {
          resolve(err!);
        });
      });

      expect(err.code).toBe(grpc.status.NOT_FOUND);
      await handle.stop();
    });

    it('returns ALREADY_EXISTS for duplicate subscription', async () => {
      mockDb._mockSelect.limit.mockResolvedValueOnce([{ id: 1 }]);

      const err = await new Promise<grpc.ServiceError>((resolve) => {
        client.Subscribe({ email: 'user@example.com', repo: 'owner/repo' }, (err) => {
          resolve(err!);
        });
      });

      expect(err.code).toBe(grpc.status.ALREADY_EXISTS);
    });

    it('returns INVALID_ARGUMENT for invalid repo format', async () => {
      const err = await new Promise<grpc.ServiceError>((resolve) => {
        client.Subscribe({ email: 'user@example.com', repo: 'invalidrepo' }, (err) => {
          resolve(err!);
        });
      });

      expect(err.code).toBe(grpc.status.INVALID_ARGUMENT);
      expect(err.details).toContain('Invalid repo format');
    });

    it('returns INVALID_ARGUMENT for empty email', async () => {
      const err = await new Promise<grpc.ServiceError>((resolve) => {
        client.Subscribe({ email: '', repo: 'owner/repo' }, (err) => {
          resolve(err!);
        });
      });

      expect(err.code).toBe(grpc.status.INVALID_ARGUMENT);
    });
  });

  describe('Confirm', () => {
    it('returns success message on valid token', async () => {
      mockDb._mockSelect.limit.mockResolvedValueOnce([{ id: 1, confirmed: false }]);

      const result = await new Promise<{ message: string }>((resolve, reject) => {
        client.Confirm({ token: 'valid-token' }, (err, res) => {
          if (err) reject(err);
          else resolve(res!);
        });
      });

      expect(result.message).toBe('Subscription confirmed successfully.');
    });

    it('returns NOT_FOUND for unknown token', async () => {
      mockDb._mockSelect.limit.mockResolvedValueOnce([]);

      const err = await new Promise<grpc.ServiceError>((resolve) => {
        client.Confirm({ token: 'bad' }, (err) => {
          resolve(err!);
        });
      });

      expect(err.code).toBe(grpc.status.NOT_FOUND);
    });

    it('returns INVALID_ARGUMENT for already confirmed', async () => {
      mockDb._mockSelect.limit.mockResolvedValueOnce([{ id: 1, confirmed: true }]);

      const err = await new Promise<grpc.ServiceError>((resolve) => {
        client.Confirm({ token: 'tok' }, (err) => {
          resolve(err!);
        });
      });

      expect(err.code).toBe(grpc.status.INVALID_ARGUMENT);
    });
  });

  describe('Unsubscribe', () => {
    it('returns success message on valid token', async () => {
      mockDb._mockSelect.limit.mockResolvedValueOnce([{ id: 1 }]);

      const result = await new Promise<{ message: string }>((resolve, reject) => {
        client.Unsubscribe({ token: 'valid-token' }, (err, res) => {
          if (err) reject(err);
          else resolve(res!);
        });
      });

      expect(result.message).toBe('Unsubscribed successfully.');
    });

    it('returns NOT_FOUND for unknown token', async () => {
      mockDb._mockSelect.limit.mockResolvedValueOnce([]);

      const err = await new Promise<grpc.ServiceError>((resolve) => {
        client.Unsubscribe({ token: 'bad' }, (err) => {
          resolve(err!);
        });
      });

      expect(err.code).toBe(grpc.status.NOT_FOUND);
    });
  });

  describe('GetSubscriptions', () => {
    it('returns subscriptions for valid email', async () => {
      const rows = [
        { email: 'u@e.com', repo: 'owner/repo', confirmed: true, lastSeenTag: 'v2.0.0' },
      ];
      mockDb._mockSelect.where.mockResolvedValueOnce(rows);

      const result = await new Promise<{
        subscriptions: GrpcSubscription[];
      }>((resolve, reject) => {
        client.GetSubscriptions({ email: 'u@e.com' }, (err, res) => {
          if (err) reject(err);
          else resolve(res!);
        });
      });

      expect(result.subscriptions).toHaveLength(1);
      expect(result.subscriptions[0].email).toBe('u@e.com');
      expect(result.subscriptions[0].repo).toBe('owner/repo');
      expect(result.subscriptions[0].confirmed).toBe(true);
      expect(result.subscriptions[0].last_seen_tag).toBe('v2.0.0');
    });

    it('returns INVALID_ARGUMENT for invalid email', async () => {
      const err = await new Promise<grpc.ServiceError>((resolve) => {
        client.GetSubscriptions({ email: 'bad' }, (err) => {
          resolve(err!);
        });
      });

      expect(err.code).toBe(grpc.status.INVALID_ARGUMENT);
    });

    it('returns empty list when no subscriptions exist', async () => {
      mockDb._mockSelect.where.mockResolvedValueOnce([]);

      const result = await new Promise<{
        subscriptions: GrpcSubscription[];
      }>((resolve, reject) => {
        client.GetSubscriptions({ email: 'nobody@example.com' }, (err, res) => {
          if (err) reject(err);
          else resolve(res!);
        });
      });

      expect(result.subscriptions).toHaveLength(0);
    });

    it('returns empty string for null last_seen_tag', async () => {
      const rows = [{ email: 'u@e.com', repo: 'owner/repo', confirmed: false, lastSeenTag: null }];
      mockDb._mockSelect.where.mockResolvedValueOnce(rows);

      const result = await new Promise<{
        subscriptions: GrpcSubscription[];
      }>((resolve, reject) => {
        client.GetSubscriptions({ email: 'u@e.com' }, (err, res) => {
          if (err) reject(err);
          else resolve(res!);
        });
      });

      expect(result.subscriptions).toHaveLength(1);
      expect(result.subscriptions[0].last_seen_tag).toBe('');
      expect(result.subscriptions[0].confirmed).toBe(false);
    });

    it('returns multiple subscriptions', async () => {
      const rows = [
        { email: 'u@e.com', repo: 'owner/repo1', confirmed: true, lastSeenTag: 'v1.0.0' },
        { email: 'u@e.com', repo: 'owner/repo2', confirmed: false, lastSeenTag: null },
      ];
      mockDb._mockSelect.where.mockResolvedValueOnce(rows);

      const result = await new Promise<{
        subscriptions: GrpcSubscription[];
      }>((resolve, reject) => {
        client.GetSubscriptions({ email: 'u@e.com' }, (err, res) => {
          if (err) reject(err);
          else resolve(res!);
        });
      });

      expect(result.subscriptions).toHaveLength(2);
      expect(result.subscriptions[0].repo).toBe('owner/repo1');
      expect(result.subscriptions[0].confirmed).toBe(true);
      expect(result.subscriptions[0].last_seen_tag).toBe('v1.0.0');
      expect(result.subscriptions[1].repo).toBe('owner/repo2');
      expect(result.subscriptions[1].confirmed).toBe(false);
      expect(result.subscriptions[1].last_seen_tag).toBe('');
    });
  });

  describe('error mapping', () => {
    it('maps unexpected errors to INTERNAL status', async () => {
      mockDb._mockSelect.limit.mockRejectedValueOnce(new Error('DB connection lost'));

      const err = await new Promise<grpc.ServiceError>((resolve) => {
        client.Confirm({ token: 'any-token' }, (err) => {
          resolve(err!);
        });
      });

      expect(err.code).toBe(grpc.status.INTERNAL);
      expect(err.details).toContain('DB connection lost');
    });
  });
});
