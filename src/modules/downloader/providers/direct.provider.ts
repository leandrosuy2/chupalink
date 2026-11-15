import { Inject, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosResponse } from 'axios';
import { createWriteStream } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { APP_CONFIG, AppConfig } from '../../../config/configuration';
import { ChupaError } from '../../../common/utils/errors';
import { assertPublicHost, safeHttpAgent, safeHttpsAgent } from '../../../common/utils/ssrf';
import { DownloadContext, VideoInfo, VideoProvider } from '../downloader.types';

const MEDIA_EXT = /\.(mp4|m4v|mov|webm)$/i;
const MAX_REDIRECTS = 5;

/**
 * Download direto de arquivos de vídeo (URL terminando em .mp4/.mov/.webm/.m4v).
 * Proteção SSRF: só IPs públicos (validados no momento da conexão, contra DNS rebinding),
 * redirects seguidos manualmente e revalidados, tamanho limitado durante o streaming.
 */
@Injectable()
export class DirectProvider implements VideoProvider {
  private readonly logger = new Logger(DirectProvider.name);
  readonly platform = 'direct';
  readonly priority = 10;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  supports(url: URL): boolean {
    return (url.protocol === 'https:' || url.protocol === 'http:') && MEDIA_EXT.test(url.pathname);
  }

  private async request(url: string, ctx: DownloadContext, method: 'HEAD' | 'GET'): Promise<AxiosResponse<Readable>> {
    let current = new URL(url);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (current.protocol !== 'https:' && current.protocol !== 'http:') {
        throw new ChupaError('BLOCKED_URL', `Protocolo não permitido no redirect: ${current.protocol}`);
      }
      await assertPublicHost(current.hostname);
      const res = await axios.request<Readable>({
        url: current.toString(),
        method,
        maxRedirects: 0,
        httpAgent: safeHttpAgent,
        httpsAgent: safeHttpsAgent,
        proxy: false,
        responseType: 'stream',
        signal: ctx.signal,
        timeout: 30_000,
        validateStatus: () => true,
        headers: { 'User-Agent': 'ChupaLink/1.0', Accept: 'video/*' },
      });
      if (res.status >= 300 && res.status < 400 && res.headers['location']) {
        res.data?.destroy?.();
        current = new URL(res.headers['location'], current);
        continue;
      }
      if (res.status === 404 || res.status === 410) {
        res.data?.destroy?.();
        throw new ChupaError('UNAVAILABLE', `HTTP ${res.status} em ${current.hostname}`);
      }
      if (res.status === 401 || res.status === 403) {
        res.data?.destroy?.();
        throw new ChupaError('PRIVATE', `HTTP ${res.status} em ${current.hostname}`);
      }
      if (res.status >= 400) {
        res.data?.destroy?.();
        throw new ChupaError('INTERRUPTED', `HTTP ${res.status} em ${current.hostname}`, res.status >= 500);
      }
      return res;
    }
    throw new ChupaError('BLOCKED_URL', 'Redirecionamentos demais');
  }

  private assertVideo(res: AxiosResponse) {
    const type = String(res.headers['content-type'] ?? '').toLowerCase();
    if (type && !type.startsWith('video/') && !type.startsWith('application/octet-stream')) {
      throw new ChupaError('NO_VIDEO', `Conteúdo não é vídeo (${type})`);
    }
  }

  async getInfo(url: string, ctx: DownloadContext): Promise<VideoInfo> {
    const res = await this.request(url, ctx, 'HEAD').catch(async (err) => {
      // alguns servidores não aceitam HEAD
      if (err instanceof ChupaError && err.code !== 'INTERRUPTED') throw err;
      return this.request(url, ctx, 'GET');
    });
    res.data?.destroy?.();
    this.assertVideo(res);
    const len = Number(res.headers['content-length']);
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? 'video');
    return {
      platform: this.platform,
      id: name,
      url,
      title: name.replace(MEDIA_EXT, ''),
      filesizeApprox: Number.isFinite(len) && len > 0 ? len : undefined,
      itemCount: 1,
    };
  }

  async download(url: string, ctx: DownloadContext): Promise<string[]> {
    const res = await this.request(url, ctx, 'GET');
    this.assertVideo(res);
    const len = Number(res.headers['content-length']);
    if (Number.isFinite(len) && len > ctx.maxBytes) {
      res.data.destroy();
      throw new ChupaError('TOO_LARGE', `Arquivo de ${len} bytes excede o limite`);
    }
    const ext = (new URL(url).pathname.match(MEDIA_EXT)?.[1] ?? 'mp4').toLowerCase();
    const file = join(ctx.workDir, `direct.${ext}`);
    let received = 0;
    const timer = setTimeout(() => res.data.destroy(new ChupaError('TIMEOUT', 'Download excedeu o tempo limite')), ctx.timeoutMs);
    res.data.on('data', (chunk: Buffer) => {
      received += chunk.length;
      ctx.onProgress?.({
        item: 1,
        items: 1,
        downloadedBytes: received,
        totalBytes: Number.isFinite(len) && len > 0 ? len : undefined,
        percent: Number.isFinite(len) && len > 0 ? Math.min(100, (received / len) * 100) : undefined,
      });
      if (received > ctx.maxBytes) res.data.destroy(new ChupaError('TOO_LARGE', 'Arquivo excede o limite'));
    });
    try {
      await pipeline(res.data, createWriteStream(file, { mode: 0o600 }));
    } catch (err) {
      if (err instanceof ChupaError) throw err;
      if (ctx.signal.aborted) throw new ChupaError('CANCELLED', 'Download cancelado');
      throw new ChupaError('INTERRUPTED', (err as Error).message, true);
    } finally {
      clearTimeout(timer);
    }
    if (Number.isFinite(len) && len > 0 && received !== len) {
      throw new ChupaError('INTERRUPTED', `Download incompleto (${received}/${len} bytes)`, true);
    }
    this.logger.debug(`Download direto concluído: ${received} bytes`);
    return [file];
  }
}
