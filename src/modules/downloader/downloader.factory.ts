import { Inject, Injectable } from '@nestjs/common';
import { ChupaError } from '../../common/utils/errors';
import { normalizeUrl } from '../../common/utils/links';
import { VIDEO_PROVIDERS, VideoProvider } from './downloader.types';

/** Escolhe o provedor adequado para uma URL. Novos provedores entram via VIDEO_PROVIDERS. */
@Injectable()
export class DownloaderFactory {
  private readonly providers: VideoProvider[];

  constructor(@Inject(VIDEO_PROVIDERS) providers: VideoProvider[]) {
    this.providers = [...providers].sort((a, b) => b.priority - a.priority);
  }

  /** Retorna o provedor ou undefined se a URL não for suportada. */
  find(url: string): VideoProvider | undefined {
    const normalized = normalizeUrl(url);
    if (!normalized) return undefined;
    const parsed = new URL(normalized);
    return this.providers.find((p) => p.supports(parsed));
  }

  resolve(url: string): VideoProvider {
    if (!normalizeUrl(url)) throw new ChupaError('INVALID_URL', `URL inválida: ${url}`);
    const provider = this.find(url);
    if (!provider) throw new ChupaError('UNSUPPORTED_PLATFORM', `Plataforma não suportada: ${new URL(url).hostname}`);
    return provider;
  }

  platforms(): string[] {
    return [...new Set(this.providers.map((p) => p.platform))];
  }
}
