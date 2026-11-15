import { LoggerService } from '@nestjs/common';
import { mkdirSync } from 'fs';
import { join } from 'path';
import pino, { Logger } from 'pino';

/** Campos que nunca devem aparecer nos logs. */
const REDACT = [
  'authorization',
  '*.authorization',
  'req.headers.authorization',
  'req.headers["x-api-token"]',
  'token',
  '*.token',
  'creds',
  '*.creds',
  'keys',
  '*.keys',
  'qr',
  '*.qr',
];

let root: Logger | undefined;

export function createRootLogger(opts: { level: string; logPath?: string; pretty?: boolean }): Logger {
  const targets: pino.TransportTargetOptions[] = [
    opts.pretty
      ? { target: 'pino-pretty', level: opts.level, options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,context,module', messageFormat: '{if context}[{context}] {end}{if module}[{module}] {end}{msg}' } }
      : { target: 'pino/file', level: opts.level, options: { destination: 1 } },
  ];
  if (opts.logPath) {
    mkdirSync(opts.logPath, { recursive: true });
    targets.push({
      target: 'pino/file',
      level: opts.level,
      options: { destination: join(opts.logPath, 'chupalink.log'), mkdir: true },
    });
  }
  root = pino({ level: opts.level, redact: { paths: REDACT, censor: '[REDACTED]' } }, pino.transport({ targets }));
  return root;
}

export function getRootLogger(): Logger {
  if (!root) root = pino({ level: process.env.LOG_LEVEL ?? 'info', redact: { paths: REDACT, censor: '[REDACTED]' } });
  return root;
}

/** Adapta o pino para o LoggerService do NestJS. */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}
  log(message: any, context?: string) {
    this.logger.info({ context }, String(message));
  }
  error(message: any, trace?: string, context?: string) {
    this.logger.error({ context, trace }, String(message));
  }
  warn(message: any, context?: string) {
    this.logger.warn({ context }, String(message));
  }
  debug(message: any, context?: string) {
    this.logger.debug({ context }, String(message));
  }
  verbose(message: any, context?: string) {
    this.logger.trace({ context }, String(message));
  }
}
