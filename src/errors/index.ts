import createError from '@fastify/error';
import { StatusCodes } from 'http-status-codes';

export const BadRequestError = createError('BAD_REQUEST', '%s', StatusCodes.BAD_REQUEST);

export const NotFoundError = createError('NOT_FOUND', '%s', StatusCodes.NOT_FOUND);

export const ConflictError = createError('CONFLICT', '%s', StatusCodes.CONFLICT);

export const UnauthorizedError = createError('UNAUTHORIZED', '%s', StatusCodes.UNAUTHORIZED);

export const TooManyRequestsError = createError(
  'TOO_MANY_REQUESTS',
  '%s',
  StatusCodes.TOO_MANY_REQUESTS,
);

export const ServiceUnavailableError = createError(
  'SERVICE_UNAVAILABLE',
  '%s',
  StatusCodes.SERVICE_UNAVAILABLE,
);
