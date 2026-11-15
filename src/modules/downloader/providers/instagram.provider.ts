import { Inject, Injectable } from '@nestjs/common';
import axios from 'axios';
import { APP_CONFIG, AppConfig } from '../../../config/configuration';
import { hostMatches } from '../../../common/utils/links';
import { safeHttpsAgent } from '../../../common/utils/ssrf';
import { DownloadContext } from '../downloader.types';
import { YtdlpProvider } from './ytdlp.provider';

const INSTAGRAM_DOMAINS = ['instagram.com', 'instagr.am'] as const;

/**
 * Instagram: Reels (/reel/, /reels/), posts com vídeo ou carrossel (/p/), IGTV (/tv/)
 * e links de compartilhamento (/share/...), que são resolvidos para a URL canônica.
 * Posts que exigem login só funcionam com INSTAGRAM_COOKIES_FILE (cookies da SUA conta).
 */
@Injectable()
export class InstagramProvider extends YtdlpProvider {
  readonly platform = 'instagram';
  readonly priority = 100;
  protected readonly domains = INSTAGRAM_DOMAINS;
  protected readonly defaultFormat = [
    'bv*[vcodec^=avc1]+ba[acodec^=mp4a]',
    'b[vcodec^=avc1]',
    'bv*[vcodec^=avc1]+ba',
    'bv*+ba',
    'b',
  ].join('/');

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super(config);
  }

  protected cookiesFile() {
    return this.config.download.instagramCookiesFile;
  }

  protected supportsPath(url: URL): boolean {
    return /^\/(?:[\w.]+\/)?(p|reel|reels|tv)\/[\w-]+/.test(url.pathname) || /^\/share\/(reel\/|p\/)?[\w-]+/.test(url.pathname) || /^\/stories\/[\w.]+\/\d+/.test(url.pathname);
  }

  /** Links /share/ redirecionam para /reel/ ou /p/; seguimos os redirects só dentro do Instagram. */
  protected async canonicalize(url: string, ctx: DownloadContext): Promise<string> {
    let current = new URL(url);
    // remove parâmetros de rastreio (igsh, utm_*) — não são necessários
    current.search = '';
    if (!current.pathname.startsWith('/share/')) return current.toString();

    for (let hop = 0; hop < 5; hop++) {
      const res = await axios.get(current.toString(), {
        maxRedirects: 0,
        httpsAgent: safeHttpsAgent,
        signal: ctx.signal,
        timeout: 15_000,
        validateStatus: () => true,
        responseType: 'stream',
        headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) ChupaLink' },
      });
      res.data?.destroy?.();
      const location = res.headers['location'];
      if (res.status < 300 || res.status >= 400 || !location) break;
      const next = new URL(location, current);
      if (next.protocol !== 'https:' || !hostMatches(next.hostname, INSTAGRAM_DOMAINS)) break;
      next.search = '';
      current = next;
      if (!current.pathname.startsWith('/share/')) break;
    }
    this.logger.debug(`Link de compartilhamento resolvido: ${url} → ${current}`);
    return current.toString();
  }
}
