import pino, { type LoggerOptions } from 'pino';

export const loggerOptions: LoggerOptions = { name: 'github-release-notifier' };

export const logger = pino(loggerOptions);
