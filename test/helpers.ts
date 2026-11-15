import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AppConfig, buildConfig, envValidationSchema } from '../src/config/configuration';

export function tempDir(prefix = 'chupalink-test-'): string {
  return mkdtempSync(join(process.env.TEST_TMPDIR ?? tmpdir(), prefix));
}

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  const root = tempDir();
  const { value, error } = envValidationSchema.validate(
    {
      APP_ENV: 'test',
      API_TOKEN: 'token-de-teste-1234567890',
      WHATSAPP_SESSION_PATH: join(root, 'sessions'),
      DOWNLOAD_PATH: join(root, 'downloads'),
      LOG_PATH: join(root, 'logs'),
      WHATSAPP_AUTO_CONNECT: 'false',
      YTDLP_PATH: process.env.YTDLP_PATH ?? 'yt-dlp',
      ...overrides,
    },
    { allowUnknown: true, convert: true },
  );
  if (error) throw error;
  return buildConfig(value);
}

export const flush = () => new Promise((r) => setImmediate(r));

export async function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condição não satisfeita');
    await new Promise((r) => setTimeout(r, 10));
  }
}
