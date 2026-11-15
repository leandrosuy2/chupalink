import { Inject, Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { basename, dirname, join } from 'path';
import { APP_CONFIG, AppConfig } from '../../config/configuration';
import { ChupaError } from '../../common/utils/errors';
import { runProcess } from '../../common/utils/process';
import { MediaProbe } from './downloader.types';

/** Verificação de integridade (ffprobe) e conversão para formato compatível com o WhatsApp (ffmpeg). */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async probe(file: string, signal?: AbortSignal): Promise<MediaProbe> {
    const { stdout, code, stderr } = await runProcess(
      this.config.download.ffprobePath,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '--', file],
      { signal, timeoutMs: 60_000 },
    );
    if (code !== 0) throw new ChupaError('CORRUPTED', `ffprobe falhou: ${stderr.trim().slice(0, 300)}`, true);
    const data = JSON.parse(stdout || '{}');
    const streams: any[] = data.streams ?? [];
    const v = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
    const a = streams.find((s) => s.codec_type === 'audio');
    const st = await fs.stat(file);
    return {
      durationSec: Number(data.format?.duration ?? v?.duration ?? 0),
      sizeBytes: st.size,
      formatName: String(data.format?.format_name ?? ''),
      video: v ? { codec: v.codec_name, width: v.width, height: v.height, pixFmt: v.pix_fmt } : undefined,
      audio: a ? { codec: a.codec_name } : undefined,
    };
  }

  /** O WhatsApp reproduz de forma confiável MP4 com H.264 (yuv420p) e áudio AAC. */
  isWhatsappCompatible(p: MediaProbe): boolean {
    return (
      /mp4|mov/.test(p.formatName) &&
      p.video?.codec === 'h264' &&
      (!p.video.pixFmt || p.video.pixFmt === 'yuv420p' || p.video.pixFmt === 'yuvj420p') &&
      (!p.audio || p.audio.codec === 'aac')
    );
  }

  /** Verifica integridade: precisa ter faixa de vídeo e duração > 0. */
  assertValid(p: MediaProbe, file: string) {
    if (p.sizeBytes === 0) throw new ChupaError('CORRUPTED', `Arquivo vazio: ${basename(file)}`, true);
    if (!p.video) throw new ChupaError('NO_VIDEO', `Arquivo sem faixa de vídeo: ${basename(file)}`);
    if (!(p.durationSec > 0)) throw new ChupaError('CORRUPTED', `Duração inválida: ${basename(file)}`, true);
  }

  async transcode(input: string, signal: AbortSignal, timeoutMs: number): Promise<string> {
    const output = join(dirname(input), `${basename(input).replace(/\.[^.]+$/, '')}.wa.mp4`);
    this.logger.log(`Convertendo ${basename(input)} para H.264/AAC (compatibilidade com WhatsApp)`);
    const { code, stderr } = await runProcess(
      this.config.download.ffmpegPath,
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', input,
        '-map', '0:v:0', '-map', '0:a:0?',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        output,
      ],
      { signal, timeoutMs },
    );
    if (code !== 0) throw new ChupaError('CORRUPTED', `ffmpeg falhou: ${stderr.trim().slice(0, 300)}`, true);
    await fs.rm(input, { force: true });
    return output;
  }
}
