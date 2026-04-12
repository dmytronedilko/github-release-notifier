import { FastifySchema } from 'fastify';
import { StatusCodes } from 'http-status-codes';

export const subscribeSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['email', 'repo'],
    properties: {
      email: { type: 'string', minLength: 1 },
      repo: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },
  response: {
    [StatusCodes.OK]: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
    },
    [StatusCodes.BAD_REQUEST]: {
      type: 'object',
      properties: {
        error: { type: 'string' },
      },
    },
    [StatusCodes.NOT_FOUND]: {
      type: 'object',
      properties: {
        error: { type: 'string' },
      },
    },
    [StatusCodes.CONFLICT]: {
      type: 'object',
      properties: {
        error: { type: 'string' },
      },
    },
  },
};

export const tokenParamsSchema: FastifySchema = {
  params: {
    type: 'object',
    required: ['token'],
    properties: {
      token: { type: 'string', minLength: 1 },
    },
  },
  response: {
    [StatusCodes.OK]: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
    },
    [StatusCodes.BAD_REQUEST]: {
      type: 'object',
      properties: {
        error: { type: 'string' },
      },
    },
    [StatusCodes.NOT_FOUND]: {
      type: 'object',
      properties: {
        error: { type: 'string' },
      },
    },
  },
};

export const subscriptionsQuerySchema: FastifySchema = {
  querystring: {
    type: 'object',
    required: ['email'],
    properties: {
      email: { type: 'string', minLength: 1 },
    },
  },
  response: {
    [StatusCodes.OK]: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          repo: { type: 'string' },
          confirmed: { type: 'boolean' },
          last_seen_tag: { type: ['string', 'null'] },
        },
      },
    },
    [StatusCodes.BAD_REQUEST]: {
      type: 'object',
      properties: {
        error: { type: 'string' },
      },
    },
  },
};
