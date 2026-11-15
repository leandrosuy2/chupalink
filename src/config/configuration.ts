import * as Joi from 'joi';
import { isAbsolute, resolve } from 'path';

/** Raiz da aplicação (pasta que contém package.json), independente do cwd. */
export const APP_ROOT = resolve(__dirname, '..', '..');

export function resolveAppPath(p: string): string {
  return isAbsolute(p) ? p : resolve(APP_ROOT, p);
}

const csv = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

export const envValidationSchema = Joi.object({
  APP_PORT: Joi.number().port().default(3000),
  APP_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  CORS_ORIGINS: Joi.string().allow('').default(''),
  API_TOKEN: Joi.string().min(16).required().invalid('alterar_esta_chave').messages({
    'any.invalid': 'API_TOKEN ainda está com o valor de exemplo — defina um token forte no .env',
    'string.min': 'API_TOKEN precisa ter pelo menos 16 caracteres',
  }),

  WHATSAPP_SESSION_NAME: Joi.string()
    .pattern(/^[a-zA-Z0-9_-]{1,64}$/)
    .default('chupalink'),
  WHATSAPP_SESSION_PATH: Joi.string().default('./storage/sessions'),
  WHATSAPP_ALLOWED_GROUPS: Joi.string().allow('').default(''),
  WHATSAPP_AUTO_CONNECT: Joi.boolean().default(true),
  WHATSAPP_QR_MAX_CYCLES: Joi.number().integer().min(1).default(5),
  WHATSAPP_VIDEO_MAX_MB: Joi.number().positive().default(100),
  WHATSAPP_DOCUMENT_MAX_MB: Joi.number().positive().default(2000),
  BOT_PROGRESS_MESSAGES: Joi.boolean().default(true),

  DOWNLOAD_PATH: Joi.string().default('./storage/downloads'),
  DOWNLOAD_MAX_SIZE_MB: Joi.number().positive().default(500),
  DOWNLOAD_TIMEOUT_SECONDS: Joi.number().integer().min(10).default(300),
  DOWNLOAD_CONCURRENCY: Joi.number().integer().min(1).max(10).default(1),
  DOWNLOAD_MAX_ATTEMPTS: Joi.number().integer().min(1).max(5).default(2),
  DOWNLOAD_MAX_ITEMS_PER_LINK: Joi.number().integer().min(1).max(20).default(10),
  VIDEO_TRANSCODE: Joi.string().valid('auto', 'never').default('auto'),

  YTDLP_PATH: Joi.string().default('yt-dlp'),
  FFMPEG_PATH: Joi.string().default('ffmpeg'),
  FFPROBE_PATH: Joi.string().default('ffprobe'),
  INSTAGRAM_COOKIES_FILE: Joi.string().allow('').default(''),
  TIKTOK_COOKIES_FILE: Joi.string().allow('').default(''),

  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace').default('info'),
  LOG_PATH: Joi.string().default('./storage/logs'),
});

export interface AppConfig {
  port: number;
  env: 'development' | 'production' | 'test';
  corsOrigins: string[];
  apiToken: string;
  whatsapp: {
    sessionName: string;
    sessionRoot: string;
    allowedGroups: string[];
    autoConnect: boolean;
    qrMaxCycles: number;
    videoMaxBytes: number;
    documentMaxBytes: number;
    progressMessages: boolean;
  };
  download: {
    path: string;
    maxBytes: number;
    timeoutMs: number;
    concurrency: number;
    maxAttempts: number;
    maxItemsPerLink: number;
    transcode: 'auto' | 'never';
    ytdlpPath: string;
    ffmpegPath: string;
    ffprobePath: string;
    instagramCookiesFile?: string;
    tiktokCookiesFile?: string;
  };
  log: { level: string; path: string };
}

const MB = 1024 * 1024;

export function buildConfig(env: Record<string, any>): AppConfig {
  const optionalPath = (v: string) => (v ? resolveAppPath(v) : undefined);
  return {
    port: Number(env.APP_PORT),
    env: env.APP_ENV,
    corsOrigins: csv(env.CORS_ORIGINS),
    apiToken: env.API_TOKEN,
    whatsapp: {
      sessionName: env.WHATSAPP_SESSION_NAME,
      sessionRoot: resolveAppPath(env.WHATSAPP_SESSION_PATH),
      allowedGroups: csv(env.WHATSAPP_ALLOWED_GROUPS),
      autoConnect: env.WHATSAPP_AUTO_CONNECT !== false && env.WHATSAPP_AUTO_CONNECT !== 'false',
      qrMaxCycles: Number(env.WHATSAPP_QR_MAX_CYCLES),
      videoMaxBytes: Number(env.WHATSAPP_VIDEO_MAX_MB) * MB,
      documentMaxBytes: Number(env.WHATSAPP_DOCUMENT_MAX_MB) * MB,
      progressMessages: env.BOT_PROGRESS_MESSAGES === true || env.BOT_PROGRESS_MESSAGES === 'true',
    },
    download: {
      path: resolveAppPath(env.DOWNLOAD_PATH),
      maxBytes: Number(env.DOWNLOAD_MAX_SIZE_MB) * MB,
      timeoutMs: Number(env.DOWNLOAD_TIMEOUT_SECONDS) * 1000,
      concurrency: Number(env.DOWNLOAD_CONCURRENCY),
      maxAttempts: Number(env.DOWNLOAD_MAX_ATTEMPTS),
      maxItemsPerLink: Number(env.DOWNLOAD_MAX_ITEMS_PER_LINK),
      transcode: env.VIDEO_TRANSCODE,
      ytdlpPath: env.YTDLP_PATH,
      ffmpegPath: env.FFMPEG_PATH,
      ffprobePath: env.FFPROBE_PATH,
      instagramCookiesFile: optionalPath(env.INSTAGRAM_COOKIES_FILE),
      tiktokCookiesFile: optionalPath(env.TIKTOK_COOKIES_FILE),
    },
    log: { level: env.LOG_LEVEL, path: resolveAppPath(env.LOG_PATH) },
  };
}

/** Valida process.env e devolve a configuração tipada. Lança erro descritivo se inválida. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const { value, error } = envValidationSchema.validate(env, {
    allowUnknown: true,
    abortEarly: false,
    convert: true,
  });
  if (error) {
    throw new Error(`Configuração inválida:\n - ${error.details.map((d) => d.message).join('\n - ')}`);
  }
  return buildConfig(value);
}

export const APP_CONFIG = Symbol('APP_CONFIG');
