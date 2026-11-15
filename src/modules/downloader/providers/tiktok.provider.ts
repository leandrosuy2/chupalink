import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../../config/configuration';
import { YtdlpProvider } from './ytdlp.provider';

/**
 * TikTok: vídeos públicos (tiktok.com/@user/video/ID) e links curtos (vm./vt.tiktok.com, /t/).
 * Prefere o formato H.264 sem marca d'água ("download" é a versão com marca d'água);
 * evita H.265 (bytevc1), que muitos celulares não reproduzem no WhatsApp.
 */
@Injectable()
export class TiktokProvider extends YtdlpProvider {
  readonly platform = 'tiktok';
  readonly priority = 100;
  protected readonly domains = ['tiktok.com'] as const;
  protected readonly defaultFormat = [
    'b[vcodec^=h264][format_id!=download]',
    'b[vcodec^=avc1][format_id!=download]',
    'b[vcodec^=h264]',
    'bv*[vcodec^=avc1]+ba',
    'b[format_id!=download]',
    'b',
  ].join('/');

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super(config);
  }

  protected cookiesFile() {
    return this.config.download.tiktokCookiesFile;
  }

  protected supportsPath(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    // links curtos: vm.tiktok.com/XXXX, vt.tiktok.com/XXXX
    if (/^(vm|vt)\.tiktok\.com$/.test(host)) return /^\/[\w-]{5,}\/?$/.test(url.pathname);
    return (
      /^\/@[\w.-]+\/video\/\d+/.test(url.pathname) ||
      /^\/@[\w.-]+\/photo\/\d+/.test(url.pathname) || // slideshow: tratado como NO_VIDEO se não houver vídeo
      /^\/(t|v)\/[\w-]+/.test(url.pathname) ||
      /^\/embed(\/v2)?\/\d+/.test(url.pathname)
    );
  }
}
