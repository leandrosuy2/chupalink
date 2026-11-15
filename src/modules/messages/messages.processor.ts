import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config/configuration';
import { ChupaError, USER_ERROR_MESSAGES } from '../../common/utils/errors';
import { formatBytes } from '../../common/utils/files';
import { dedupeKey } from '../../common/utils/links';
import { DownloaderService } from '../downloader/downloader.service';
import { PreparedVideo, VideoInfo } from '../downloader/downloader.types';
import { GroupsService } from '../groups/groups.service';
import { JobsService } from '../jobs/jobs.service';
import { Job, JobHandler, JobResult, JobResultFile, JobRunContext, JobStatus } from '../jobs/jobs.types';
import type { WAMessage } from '../whatsapp/baileys';
import { WhatsappEvents } from '../whatsapp/whatsapp.events';
import { WhatsappGateway } from '../whatsapp/whatsapp.gateway';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { WA_EVENTS } from '../whatsapp/whatsapp.types';
import { Phase, PHRASES, pick, renderCaption } from './bot-messages';
import { MessagesService } from './messages.service';
import { IncomingMessage } from './messages.types';
import { StatusMessage } from './status-message';

/** Mensagens mais antigas que isso (ex.: acumuladas com o bot offline) são ignoradas. */
const MAX_MESSAGE_AGE_MS = 15 * 60_000;
/** Mesmo link no mesmo grupo dentro desta janela não é baixado de novo. */
const DUPLICATE_WINDOW_MS = 10 * 60_000;
const SEEN_IDS_LIMIT = 2000;

interface JobContext {
  quoted?: WAMessage;
  /** Mensagem de status "ao vivo" (undefined se BOT_PROGRESS_MESSAGES=false). */
  status?: StatusMessage;
  /** Etapa em que a última tentativa falhou (mostrada na mensagem de erro). */
  failedAt?: Phase;
}

/**
 * Fluxo do ChupaLink: mensagem no grupo → links → tarefa na fila → download → envio do vídeo.
 * Cada link ganha UMA mensagem de status que é editada conforme o andamento.
 */
@Injectable()
export class MessagesProcessor implements OnModuleInit, OnModuleDestroy, JobHandler {
  private readonly logger = new Logger('ChupaLink');
  private readonly seenIds = new Set<string>();
  private unsubscribe: Array<() => void> = [];

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly events: WhatsappEvents,
    private readonly messages: MessagesService,
    private readonly groups: GroupsService,
    private readonly jobs: JobsService,
    private readonly downloader: DownloaderService,
    private readonly whatsapp: WhatsappService,
    private readonly gateway: WhatsappGateway,
  ) {}

  onModuleInit() {
    this.jobs.registerHandler(this);
    this.unsubscribe.push(
      this.events.on(WA_EVENTS.MESSAGE, (msg) =>
        this.handleMessage(msg).catch((err) => this.logger.error(`Erro ao processar mensagem: ${err.message}`)),
      ),
      this.jobs.onUpdate((job) => this.gateway.broadcast('job.update', job)),
    );
  }

  onModuleDestroy() {
    this.unsubscribe.forEach((u) => u());
  }

  // ------------------------------------------------------------ entrada

  async handleMessage(raw: WAMessage): Promise<void> {
    const msg = this.messages.parse(raw);
    if (!msg) return;
    // Nunca reage ao que o próprio bot enviou. Mensagens "fromMe" digitadas no celular
    // do mesmo número (o dono do bot) são processadas normalmente.
    if (msg.fromMe && this.whatsapp.wasSentByBot(msg.id)) return;
    if (!msg.isGroup) return; // não atua em conversas privadas
    if (!this.groups.isAllowed(msg.chatJid)) {
      if (msg.links.length) this.logger.debug(`Link ignorado: grupo não autorizado ${msg.chatJid}`);
      return;
    }
    if (this.seenIds.has(msg.id)) return; // redelivery do WhatsApp
    this.remember(msg.id);
    if (Date.now() - msg.timestamp.getTime() > MAX_MESSAGE_AGE_MS) {
      this.logger.debug(`Mensagem antiga ignorada (${msg.timestamp.toISOString()})`);
      return;
    }

    this.logger.log(
      `Mensagem de ${msg.senderName ?? msg.sender} em ${msg.chatJid} às ${msg.timestamp.toISOString()}` +
        (msg.links.length ? ` — ${msg.links.length} link(s)` : ''),
    );
    if (!msg.links.length) return;

    const supported = msg.links.filter((l) => this.downloader.isSupported(l));
    for (const l of msg.links) {
      this.logger.log(`Link identificado: ${l} → ${this.downloader.platformOf(l) ?? 'não suportado'}`);
    }
    if (!supported.length) return; // links comuns (notícias etc.) não geram resposta

    for (const url of supported) await this.enqueueLink(msg, url);
  }

  async enqueueLink(msg: Pick<IncomingMessage, 'chatJid' | 'sender' | 'senderName' | 'id' | 'raw'>, url: string) {
    const key = dedupeKey(url);
    const recent = this.jobs.findRecentCompleted(msg.chatJid, key, DUPLICATE_WINDOW_MS);
    if (recent) {
      await this.reply(msg.chatJid, pick(PHRASES.duplicate), msg.raw);
      return { job: recent, duplicate: true, position: -1 };
    }
    const platform = this.downloader.platformOf(url) ?? 'unknown';
    const context: JobContext = { quoted: msg.raw };
    const res = this.jobs.enqueue({
      url,
      platform,
      dedupeKey: key,
      chatJid: msg.chatJid,
      chatName: await this.groups.getName(msg.chatJid),
      sender: msg.sender,
      senderName: msg.senderName,
      messageId: msg.id,
      context,
    });
    if (res.duplicate) {
      this.logger.log(`Link já está na fila (${res.job.id}) — ignorando duplicata`);
      return res;
    }
    if (this.config.whatsapp.progressMessages) {
      // a tarefa pode começar antes do envio terminar: o StatusMessage serializa as edições
      context.status = new StatusMessage(this.whatsapp, msg.chatJid, msg.raw, {
        phase: res.position > 0 ? 'queued' : 'searching',
        platform,
        queuePosition: res.position + 1,
      });
      void context.status.update({}, true);
    }
    return res;
  }

  private remember(id: string) {
    this.seenIds.add(id);
    if (this.seenIds.size > SEEN_IDS_LIMIT) this.seenIds.delete(this.seenIds.values().next().value as string);
  }

  // ------------------------------------------------------------ processamento (JobHandler)

  async process(job: Job, context: unknown, run: JobRunContext): Promise<JobResult> {
    const ctx = (context as JobContext | undefined) ?? {};
    const { quoted, status } = ctx;
    const startedAt = Date.now();
    let sendingStarted = false;
    let failedAt: Phase = 'searching';
    try {
      await status?.update({ phase: 'searching' }, true);
      const result = await this.downloader.download({
        url: job.url,
        jobId: job.id,
        signal: run.signal,
        onStage: async (stage, info) => {
          if (stage === 'info' && info) {
            await status?.update({ uploader: info.uploader });
          } else if (stage === 'downloading') {
            failedAt = 'downloading';
            run.setStatus(JobStatus.DOWNLOADING);
            await status?.update({ phase: 'downloading' }, true);
          } else if (stage === 'converting') {
            failedAt = 'converting';
            await status?.update({ phase: 'converting', converted: true }, true);
          }
        },
        onProgress: (p) => void status?.update({ progress: p }),
      });

      failedAt = 'sending';
      sendingStarted = true;
      run.setStatus(JobStatus.SENDING, `${result.files.length} arquivo(s)`);
      const total = result.files.reduce((a, f) => a + f.sizeBytes, 0);
      await status?.update(
        { phase: 'sending', downloadedBytes: total, progress: undefined, sendIndex: 1, sendTotal: result.files.length },
        true,
      );

      const sent: JobResultFile[] = [];
      for (const [i, file] of result.files.entries()) {
        if (i > 0) await status?.update({ sendIndex: i + 1 });
        sent.push(await this.sendFile(job, result.info, file, i, result.files.length, quoted, run.signal));
      }
      await status?.update({ phase: 'done', elapsedMs: Date.now() - startedAt }, true);
      await status?.settle();
      this.logger.log(`Tarefa ${job.id}: ${sent.length} vídeo(s) enviado(s) para ${job.chatName ?? job.chatJid}`);
      return { title: result.info.title, uploader: result.info.uploader, files: sent };
    } catch (err) {
      ctx.failedAt = failedAt; // a mensagem de falha mostra em qual etapa parou
      // depois que o envio começou, não repetimos a tarefa (evita mandar o mesmo vídeo duas vezes)
      if (sendingStarted && err instanceof ChupaError && err.retryable) {
        throw new ChupaError(err.code, err.message, false);
      }
      throw err;
    } finally {
      await this.downloader.cleanup(job.id).catch(() => undefined);
    }
  }

  private async sendFile(
    job: Job,
    info: VideoInfo,
    file: PreparedVideo,
    index: number,
    total: number,
    quoted: WAMessage | undefined,
    signal: AbortSignal,
  ): Promise<JobResultFile> {
    const { videoMaxBytes, documentMaxBytes } = this.config.whatsapp;
    if (file.sizeBytes > documentMaxBytes) {
      throw new ChupaError('TOO_LARGE', `${formatBytes(file.sizeBytes)} excede o limite de envio do WhatsApp`);
    }
    const asDocument = file.sizeBytes > videoMaxBytes;
    const caption = this.caption(info, file, index, total, asDocument);

    // até 2 tentativas de envio — nunca indefinidamente
    for (let attempt = 1; ; attempt++) {
      if (signal.aborted) throw signal.reason ?? new ChupaError('CANCELLED', 'Cancelada');
      try {
        await this.whatsapp.sendVideo(job.chatJid, file.path, { caption, fileName: file.fileName, quoted, asDocument, mimetype: file.mimetype });
        this.logger.log(`Enviado ${file.fileName} (${formatBytes(file.sizeBytes)}) como ${asDocument ? 'documento' : 'vídeo'}`);
        return {
          fileName: file.fileName,
          sizeBytes: file.sizeBytes,
          durationSec: file.durationSec,
          sentAs: asDocument ? 'document' : 'video',
          transcoded: file.transcoded,
        };
      } catch (err) {
        if (attempt >= 2 || (err instanceof ChupaError && err.code === 'NOT_CONNECTED')) {
          throw err instanceof ChupaError ? err : new ChupaError('SEND_FAILED', (err as Error).message);
        }
        this.logger.warn(`Envio falhou (${(err as Error).message}); nova tentativa em 3s`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  caption(info: VideoInfo, file: PreparedVideo, index: number, total: number, asDocument: boolean): string {
    return renderCaption({
      platform: info.platform,
      uploader: info.uploader,
      title: info.title,
      durationSec: file.durationSec,
      width: file.width,
      height: file.height,
      sizeBytes: file.sizeBytes,
      index,
      total,
      asDocument,
    });
  }

  async onFailed(job: Job, context: unknown): Promise<void> {
    const { quoted, status, failedAt } = (context as JobContext | undefined) ?? {};
    const code = job.error?.code ?? 'UNKNOWN';
    if (code === 'NOT_CONNECTED') return; // não há como avisar sem conexão
    let text = USER_ERROR_MESSAGES[code] ?? USER_ERROR_MESSAGES.UNKNOWN;
    if (code === 'TOO_LARGE') text += ` _(limite: ${formatBytes(this.config.download.maxBytes)})_`;
    if (status) {
      await status.update({ phase: 'failed', failedAt: failedAt ?? 'searching', errorText: text, progress: undefined }, true);
      await status.settle();
      return;
    }
    await this.reply(job.chatJid, text, quoted);
  }

  // ------------------------------------------------------------ envio de texto

  private async reply(jid: string, text: string, quoted?: WAMessage) {
    try {
      await this.whatsapp.sendText(jid, text, quoted);
    } catch (err) {
      this.logger.warn(`Não foi possível enviar mensagem para ${jid}: ${(err as Error).message}`);
    }
  }
}
