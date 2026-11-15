import { Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import { join } from 'path';
import { AppConfig } from '../../../config/configuration';
import { ChupaError } from '../../../common/utils/errors';
import { listFiles } from '../../../common/utils/files';
import { hostMatches } from '../../../common/utils/links';
import { runProcess } from '../../../common/utils/process';
import { DownloadContext, DownloadProgress, Platform, VideoInfo, VideoProvider } from '../downloader.types';

const VIDEO_EXT = /\.(mp4|mkv|webm|mov|m4v)$/i;
const PROGRESS_PREFIX = 'CHUPA|';
const PROGRESS_TEMPLATE =
  `download:${PROGRESS_PREFIX}%(info.playlist_index)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s`;

/**
 * Lê as linhas de progresso do yt-dlp. O progresso nunca volta para trás no mesmo item
 * (vídeo + áudio separados são baixados em sequência e reiniciariam a contagem).
 */
export function createYtdlpProgressParser(items: number, emit: (p: DownloadProgress) => void) {
  let best: DownloadProgress | undefined;
  return (line: string) => {
    const at = line.indexOf(PROGRESS_PREFIX);
    if (at < 0) return;
    const [idx, downloaded, total, estimate] = line.slice(at + PROGRESS_PREFIX.length).trim().split('|');
    const num = (v?: string) => (v && v !== 'NA' && v !== 'None' && Number.isFinite(Number(v)) ? Number(v) : undefined);
    const item = num(idx) ?? 1;
    const downloadedBytes = num(downloaded) ?? 0;
    const totalBytes = num(total) ?? num(estimate);
    const percent = totalBytes ? Math.min(100, Math.max(0, (downloadedBytes / totalBytes) * 100)) : undefined;
    const next: DownloadProgress = { item, items: Math.max(items, item), downloadedBytes, totalBytes, percent };
    if (best && best.item === item && (next.percent ?? 0) < (best.percent ?? 0)) return;
    best = next;
    emit(next);
  };
}

/** Converte a saída de erro do yt-dlp em um erro de domínio com mensagem amigável. */
export function mapYtdlpError(stderr: string, platform: string): ChupaError {
  const s = stderr.toLowerCase();
  const last = stderr.trim().split('\n').filter((l) => l.includes('ERROR')).pop() ?? stderr.trim().split('\n').pop() ?? '';
  const msg = `[${platform}] ${last.slice(0, 500)}`;
  if (/larger than max-filesize|file is larger than/.test(s)) return new ChupaError('TOO_LARGE', msg);
  if (/unsupported url/.test(s)) return new ChupaError('UNSUPPORTED_PLATFORM', msg);
  if (/\bdrm\b/.test(s)) return new ChupaError('PRIVATE', msg);
  if (/private|this account is private|only available to (followers|subscribers)/.test(s))
    return new ChupaError('PRIVATE', msg);
  if (/there is no video in this post|no video formats found|requested format is not available|not a video/.test(s))
    return new ChupaError('NO_VIDEO', msg);
  if (/blocked from accessing this post|not available in your (country|region)|geo.?restrict/.test(s))
    return new ChupaError('UNAVAILABLE', msg);
  if (/http error 429|too many requests|rate.?limit reached(?! or login)/.test(s))
    return new ChupaError('RATE_LIMITED', msg, true);
  if (/login required|rate-limit reached or login required|use --cookies|cookies|sign in|log in|logged.in|authentication/.test(s))
    return new ChupaError('LOGIN_REQUIRED', msg);
  if (/video (is )?unavailable|not available|has been removed|http error 404|does not exist|unable to find video|post is unavailable|status code 10204|item has been deleted/.test(s))
    return new ChupaError('UNAVAILABLE', msg);
  if (/timed? ?out|connection reset|incomplete|interrupted|broken pipe|network is unreachable|temporary failure/.test(s))
    return new ChupaError('INTERRUPTED', msg, true);
  return new ChupaError('UNKNOWN', msg, true);
}

/**
 * Base para plataformas suportadas pelo yt-dlp.
 * O yt-dlp é executado sem shell, com argumentos separados e "--" antes da URL
 * (impede que uma URL seja interpretada como opção).
 */
export abstract class YtdlpProvider implements VideoProvider {
  protected readonly logger: Logger;
  abstract readonly platform: Platform;
  abstract readonly priority: number;
  /** Domínios aceitos (subdomínios incluídos). */
  protected abstract readonly domains: readonly string[];
  /** Seletor de formato padrão — prioriza H.264/AAC, que o WhatsApp reproduz em todos os aparelhos. */
  protected abstract readonly defaultFormat: string;

  constructor(protected readonly config: AppConfig) {
    this.logger = new Logger(this.constructor.name);
  }

  protected cookiesFile(): string | undefined {
    return undefined;
  }

  /** Regras extras de caminho (ex.: só /reel/ e /p/). */
  protected abstract supportsPath(url: URL): boolean;

  supports(url: URL): boolean {
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? hostMatches(url.hostname, this.domains) && this.supportsPath(url)
      : false;
  }

  protected baseArgs(): string[] {
    const args = [
      '--ignore-config',
      '--no-color',
      '--socket-timeout',
      '30',
      '--retries',
      '3',
      '--fragment-retries',
      '3',
    ];
    const cookies = this.cookiesFile();
    if (cookies) {
      if (existsSync(cookies)) args.push('--cookies', cookies);
      else this.logger.warn(`Arquivo de cookies não encontrado: ${cookies}`);
    }
    return args;
  }

  /** Permite ao provedor ajustar a URL antes do yt-dlp (ex.: resolver links /share/). */
  protected async canonicalize(url: string, _ctx: DownloadContext): Promise<string> {
    return url;
  }

  async getInfo(url: string, ctx: DownloadContext): Promise<VideoInfo> {
    const target = await this.canonicalize(url, ctx);
    const { stdout, stderr, code } = await runProcess(
      this.config.download.ytdlpPath,
      [...this.baseArgs(), '--no-progress', '-J', '--playlist-items', `1:${ctx.maxItems}`, '--', target],
      { signal: ctx.signal, timeoutMs: Math.min(ctx.timeoutMs, 90_000) },
    );
    if (code !== 0 || !stdout.trim()) throw mapYtdlpError(stderr, this.platform);

    const data = JSON.parse(stdout);
    const entries: any[] = data._type === 'playlist' ? (data.entries ?? []).filter(Boolean) : [data];
    const videos = entries.filter((e) => this.hasVideo(e));
    if (!videos.length) throw new ChupaError('NO_VIDEO', `[${this.platform}] post sem vídeo: ${url}`);
    if (videos.some((v) => v.is_live || v.live_status === 'is_live')) {
      throw new ChupaError('UNAVAILABLE', `[${this.platform}] transmissões ao vivo não são suportadas`);
    }
    const first = videos[0];
    const sizes = videos.map((v) => v.filesize ?? v.filesize_approx ?? 0);
    return {
      platform: this.platform,
      id: String(data.id ?? first.id),
      url,
      title: (data.title ?? first.title ?? first.description ?? '').toString().slice(0, 200) || undefined,
      uploader: first.uploader ?? first.channel ?? data.uploader ?? undefined,
      durationSec: videos.reduce((acc, v) => acc + (v.duration ?? 0), 0) || undefined,
      filesizeApprox: sizes.every((s) => s > 0) ? sizes.reduce((a, b) => a + b, 0) : undefined,
      thumbnail: first.thumbnail ?? undefined,
      itemCount: videos.length,
    };
  }

  private hasVideo(entry: any): boolean {
    if (!entry) return false;
    if (entry.vcodec && entry.vcodec !== 'none') return true;
    return (entry.formats ?? []).some((f: any) => f.vcodec && f.vcodec !== 'none');
  }

  async download(url: string, ctx: DownloadContext, info?: VideoInfo): Promise<string[]> {
    const target = await this.canonicalize(url, ctx);
    const args = [
      ...this.baseArgs(),
      '--newline',
      '--progress',
      '--progress-template',
      PROGRESS_TEMPLATE,
      '-f',
      ctx.format ?? this.defaultFormat,
      '--merge-output-format',
      'mp4',
      '--max-filesize',
      String(ctx.maxBytes),
      '--playlist-items',
      `1:${ctx.maxItems}`,
      '--restrict-filenames',
      '--no-mtime',
      '--no-write-thumbnail',
      '--no-write-info-json',
      '--ffmpeg-location',
      this.config.download.ffmpegPath,
      '-o',
      join(ctx.workDir, '%(playlist_index|0)02d_%(id)s.%(ext)s'),
      '--',
      target,
    ];
    this.logger.debug(`yt-dlp ${args.filter((a) => a !== this.cookiesFile()).join(' ')}`);
    const { stderr, stdout, code } = await runProcess(this.config.download.ytdlpPath, args, {
      signal: ctx.signal,
      timeoutMs: ctx.timeoutMs,
      cwd: ctx.workDir,
      onLine: ctx.onProgress ? createYtdlpProgressParser(info?.itemCount ?? 1, ctx.onProgress) : undefined,
    });
    const output = `${stdout}\n${stderr}`;
    if (/larger than max-filesize|file is larger than/i.test(output)) {
      throw new ChupaError('TOO_LARGE', `[${this.platform}] vídeo maior que ${Math.round(ctx.maxBytes / 1048576)} MB`);
    }
    if (code !== 0) throw mapYtdlpError(stderr, this.platform);

    const files = (await listFiles(ctx.workDir)).filter((f) => VIDEO_EXT.test(f) && !/\.(part|ytdl)$/i.test(f)).sort();
    if (!files.length) throw new ChupaError('INTERRUPTED', `[${this.platform}] yt-dlp terminou sem gerar arquivo`, true);
    return files;
  }
}
