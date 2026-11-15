import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { promises as fs } from 'fs';
import { basename, join } from 'path';
import { APP_CONFIG, AppConfig } from '../../config/configuration';
import { ChupaError } from '../../common/utils/errors';
import { formatBytes, removeDir, sanitizeFileName } from '../../common/utils/files';
import { runProcess } from '../../common/utils/process';
import { assertPublicHost } from '../../common/utils/ssrf';
import { DownloaderFactory } from './downloader.factory';
import { DownloadContext, DownloadProgress, DownloadResult, DownloadStage, PreparedVideo, VideoInfo } from './downloader.types';
import { MediaService } from './media.service';

export interface DownloadRequest {
  url: string;
  /** Identificador da tarefa — usado como nome da pasta temporária. */
  jobId: string;
  signal: AbortSignal;
  onStage?: (stage: DownloadStage, info?: VideoInfo) => void | Promise<void>;
  onProgress?: (p: DownloadProgress) => void;
  format?: string;
}

@Injectable()
export class DownloaderService implements OnModuleInit {
  private readonly logger = new Logger(DownloaderService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly factory: DownloaderFactory,
    private readonly media: MediaService,
  ) {}

  async onModuleInit() {
    await fs.mkdir(this.config.download.path, { recursive: true, mode: 0o700 });
    // sobras de execuções interrompidas (ex.: queda de energia)
    for (const entry of await fs.readdir(this.config.download.path)) {
      if (entry.startsWith('job-')) await removeDir(join(this.config.download.path, entry));
    }
    await this.checkBinaries();
  }

  private async checkBinaries() {
    const { ytdlpPath, ffmpegPath, ffprobePath } = this.config.download;
    for (const [bin, args] of [
      [ytdlpPath, ['--version']],
      [ffmpegPath, ['-version']],
      [ffprobePath, ['-version']],
    ] as const) {
      try {
        const { stdout } = await runProcess(bin, [...args], { timeoutMs: 15_000 });
        this.logger.log(`${basename(bin)}: ${stdout.split('\n')[0].trim()}`);
      } catch (err) {
        this.logger.error(`${bin} indisponível — downloads vão falhar. ${(err as Error).message}`);
      }
    }
  }

  isSupported(url: string): boolean {
    return !!this.factory.find(url);
  }

  platformOf(url: string): string | undefined {
    return this.factory.find(url)?.platform;
  }

  platforms() {
    return this.factory.platforms();
  }

  private context(jobId: string, signal: AbortSignal, format?: string): DownloadContext {
    return {
      workDir: join(this.config.download.path, `job-${sanitizeFileName(jobId, 'x', 64)}`),
      signal,
      maxBytes: this.config.download.maxBytes,
      timeoutMs: this.config.download.timeoutMs,
      maxItems: this.config.download.maxItemsPerLink,
      format,
    };
  }

  /** Obtém metadados (título, duração, tamanho estimado, thumbnail) sem baixar. */
  async inspect(url: string, signal: AbortSignal = new AbortController().signal): Promise<VideoInfo> {
    const provider = this.factory.resolve(url);
    await assertPublicHost(new URL(url).hostname);
    return provider.getInfo(url, this.context('inspect', signal));
  }

  /**
   * Fluxo completo: valida → identifica plataforma → metadados → download → verificação/conversão.
   * Os arquivos ficam na pasta da tarefa; chame cleanup(jobId) após o envio.
   */
  async download(req: DownloadRequest): Promise<DownloadResult> {
    const provider = this.factory.resolve(req.url);
    await assertPublicHost(new URL(req.url).hostname);
    const ctx = this.context(req.jobId, req.signal, req.format);
    ctx.onProgress = req.onProgress;
    await fs.mkdir(ctx.workDir, { recursive: true, mode: 0o700 });

    const info = await provider.getInfo(req.url, ctx);
    this.logger.log(
      `[${info.platform}] "${info.title ?? info.id}" — ${info.itemCount} vídeo(s)` +
        (info.durationSec ? `, ${Math.round(info.durationSec)}s` : '') +
        (info.filesizeApprox ? `, ~${formatBytes(info.filesizeApprox)}` : ''),
    );
    await req.onStage?.('info', info);
    if (info.filesizeApprox && info.filesizeApprox > ctx.maxBytes) {
      throw new ChupaError('TOO_LARGE', `Tamanho estimado ${formatBytes(info.filesizeApprox)} excede o limite`);
    }

    await req.onStage?.('downloading', info);
    const started = Date.now();
    const raw = await provider.download(req.url, ctx, info);
    await req.onStage?.('processing', info);

    const files: PreparedVideo[] = [];
    for (const [i, file] of raw.entries()) {
      files.push(await this.prepare(file, info, i, raw.length, ctx, () => req.onStage?.('converting', info)));
    }
    const total = files.reduce((a, f) => a + f.sizeBytes, 0);
    this.logger.log(`[${info.platform}] download concluído: ${files.length} arquivo(s), ${formatBytes(total)} em ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return { info, files };
  }

  private async prepare(
    file: string,
    info: VideoInfo,
    index: number,
    total: number,
    ctx: DownloadContext,
    onConvert?: () => unknown,
  ): Promise<PreparedVideo> {
    let path = file;
    let probe = await this.media.probe(path, ctx.signal);
    this.media.assertValid(probe, path);
    let transcoded = false;
    if (!this.media.isWhatsappCompatible(probe)) {
      if (this.config.download.transcode === 'auto') {
        await onConvert?.();
        path = await this.media.transcode(path, ctx.signal, ctx.timeoutMs);
        probe = await this.media.probe(path, ctx.signal);
        this.media.assertValid(probe, path);
        transcoded = true;
      } else {
        this.logger.warn(`${basename(path)} não é H.264/AAC (${probe.video?.codec}/${probe.audio?.codec}); enviando sem converter`);
      }
    }
    if (probe.sizeBytes > ctx.maxBytes) {
      throw new ChupaError('TOO_LARGE', `Arquivo final ${formatBytes(probe.sizeBytes)} excede o limite`);
    }
    const base = sanitizeFileName(info.title || `${info.platform}_${info.id}`, `${info.platform}_video`, 60);
    return {
      path,
      fileName: `${base}${total > 1 ? `_${index + 1}` : ''}.mp4`,
      mimetype: 'video/mp4',
      sizeBytes: probe.sizeBytes,
      durationSec: probe.durationSec,
      width: probe.video?.width,
      height: probe.video?.height,
      transcoded,
    };
  }

  async cleanup(jobId: string) {
    await removeDir(this.context(jobId, new AbortController().signal).workDir);
  }
}
