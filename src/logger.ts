import type { LogContext, Logger } from './types/logger';

type Level = keyof Logger;

function write(level: Level, message: string, context?: LogContext): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}`;
  console[level](...(context ? [line, context] : [line]));
}

export const logger: Logger = {
  debug: (message, context) => write('debug', message, context),
  info: (message, context) => write('info', message, context),
  warn: (message, context) => write('warn', message, context),
  error: (message, context) => write('error', message, context),
};
