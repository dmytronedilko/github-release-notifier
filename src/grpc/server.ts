import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { StatusCodes } from 'http-status-codes';

import type { SubscriptionService } from '../services/SubscriptionService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = resolve(__dirname, '../../proto/notifier.proto');

interface SubscribeRequest {
  email: string;
  repo: string;
}

interface TokenRequest {
  token: string;
}

interface GetSubscriptionsRequest {
  email: string;
}

type GrpcCallback<T> = (error: grpc.ServiceError | null, response?: T) => void;

function mapErrorToGrpcStatus(err: unknown): grpc.ServiceError {
  const error = err as { statusCode?: number; message?: string };
  const message = error.message ?? 'Internal server error';

  let code: grpc.status;
  switch (error.statusCode) {
    case StatusCodes.BAD_REQUEST:
      code = grpc.status.INVALID_ARGUMENT;
      break;
    case StatusCodes.NOT_FOUND:
      code = grpc.status.NOT_FOUND;
      break;
    case StatusCodes.CONFLICT:
      code = grpc.status.ALREADY_EXISTS;
      break;
    default:
      code = grpc.status.INTERNAL;
  }

  return { code, message, details: message, metadata: new grpc.Metadata(), name: 'Error' };
}

export interface GrpcServerHandle {
  server: grpc.Server;
  start(port: number): Promise<number>;
  stop(): Promise<void>;
}

export function createGrpcServer(subscriptionService: SubscriptionService): GrpcServerHandle {
  const packageDef = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const proto = grpc.loadPackageDefinition(packageDef) as Record<string, unknown>;
  const notifierPkg = proto.notifier as { NotifierService: { service: grpc.ServiceDefinition } };

  const server = new grpc.Server();

  server.addService(notifierPkg.NotifierService.service, {
    Subscribe(
      call: grpc.ServerUnaryCall<SubscribeRequest, unknown>,
      callback: GrpcCallback<{ message: string }>,
    ): void {
      const { email, repo } = call.request;
      subscriptionService
        .subscribe(email, repo)
        .then(() => {
          callback(null, { message: 'Subscription successful. Confirmation email sent.' });
        })
        .catch((err: unknown) => {
          callback(mapErrorToGrpcStatus(err));
        });
    },

    Confirm(
      call: grpc.ServerUnaryCall<TokenRequest, unknown>,
      callback: GrpcCallback<{ message: string }>,
    ): void {
      subscriptionService
        .confirm(call.request.token)
        .then(() => {
          callback(null, { message: 'Subscription confirmed successfully.' });
        })
        .catch((err: unknown) => {
          callback(mapErrorToGrpcStatus(err));
        });
    },

    Unsubscribe(
      call: grpc.ServerUnaryCall<TokenRequest, unknown>,
      callback: GrpcCallback<{ message: string }>,
    ): void {
      subscriptionService
        .unsubscribe(call.request.token)
        .then(() => {
          callback(null, { message: 'Unsubscribed successfully.' });
        })
        .catch((err: unknown) => {
          callback(mapErrorToGrpcStatus(err));
        });
    },

    GetSubscriptions(
      call: grpc.ServerUnaryCall<GetSubscriptionsRequest, unknown>,
      callback: GrpcCallback<{ subscriptions: unknown[] }>,
    ): void {
      subscriptionService
        .getSubscriptions(call.request.email)
        .then((subs) => {
          callback(null, {
            subscriptions: subs.map((s) => ({
              email: s.email,
              repo: s.repo,
              confirmed: s.confirmed,
              last_seen_tag: s.last_seen_tag ?? '',
            })),
          });
        })
        .catch((err: unknown) => {
          callback(mapErrorToGrpcStatus(err));
        });
    },
  });

  return {
    server,

    start(port: number): Promise<number> {
      return new Promise((resolve, reject) => {
        server.bindAsync(
          `0.0.0.0:${port}`,
          grpc.ServerCredentials.createInsecure(),
          (err, boundPort) => {
            if (err) {
              reject(err);
              return;
            }
            resolve(boundPort);
          },
        );
      });
    },

    stop(): Promise<void> {
      return new Promise((resolve) => {
        server.tryShutdown(() => {
          resolve();
        });
      });
    },
  };
}
