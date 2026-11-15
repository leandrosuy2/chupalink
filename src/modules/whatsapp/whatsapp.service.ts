import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ChupaError } from '../../common/utils/errors';
import type { WAMessage, WAMessageKey } from './baileys';
import { WhatsappConnection } from './whatsapp.connection';
import { ConnectionStatus } from './whatsapp.types';

export interface SendVideoOptions {
  caption?: string;
  fileName: string;
  quoted?: WAMessage;
  /** Envia como documento (para arquivos acima do limite de vídeo do WhatsApp). */
  asDocument?: boolean;
  mimetype?: string;
}

/** Fachada de alto nível sobre a conexão: usada pelo controller e pelos outros módulos. */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(private readonly connection: WhatsappConnection) {}

  status() {
    return this.connection.snapshot();
  }

  isConnected() {
    return this.connection.isConnected();
  }

  wasSentByBot(messageId: string) {
    return this.connection.wasSentByBot(messageId);
  }

  qr() {
    const qr = this.connection.getQr();
    if (!qr) {
      const status = this.connection.getStatus();
      throw new NotFoundException(
        status === ConnectionStatus.CONNECTED
          ? 'Já conectado — não há QR Code.'
          : `Nenhum QR Code disponível no momento (status: ${status}). Use POST /api/whatsapp/connect.`,
      );
    }
    return { dataUrl: qr.dataUrl, base64: qr.dataUrl.split(',')[1], generatedAt: qr.generatedAt, cycle: qr.cycle };
  }

  connect() {
    return this.connection.start();
  }

  disconnect() {
    return this.connection.stop();
  }

  logout(confirm: string) {
    if (confirm !== 'LOGOUT') {
      throw new BadRequestException('Para deslogar e APAGAR a sessão local envie {"confirm":"LOGOUT"}');
    }
    return this.connection.logout();
  }

  async profile() {
    const sock = this.connection.socket;
    const user = sock.user!;
    const [picture, status] = await Promise.all([
      sock.profilePictureUrl(user.id, 'image').catch(() => undefined),
      sock
        .fetchStatus(user.id)
        .then((r: any) => r?.[0]?.status?.status ?? undefined)
        .catch(() => undefined),
    ]);
    return { id: user.id, lid: user.lid, name: user.name ?? user.notify, pictureUrl: picture, status };
  }

  async sendText(jid: string, text: string, quoted?: WAMessage) {
    return this.connection.sendMessage(jid, { text }, { quoted });
  }

  /** Edita uma mensagem de texto já enviada pelo bot (usado na mensagem de status ao vivo). */
  async editText(jid: string, key: WAMessageKey, text: string) {
    return this.connection.sendMessage(jid, { text, edit: key });
  }

  /** Envia um arquivo do disco por streaming (o Baileys lê com createReadStream, sem carregar tudo em memória). */
  async sendVideo(jid: string, filePath: string, opts: SendVideoOptions) {
    const mimetype = opts.mimetype ?? 'video/mp4';
    try {
      const content = opts.asDocument
        ? { document: { url: filePath }, mimetype, fileName: opts.fileName, caption: opts.caption }
        : { video: { url: filePath }, mimetype, fileName: opts.fileName, caption: opts.caption };
      return await this.connection.sendMessage(jid, content, { quoted: opts.quoted });
    } catch (err) {
      if (err instanceof ChupaError) throw err;
      this.logger.error(`Falha ao enviar mídia para ${jid}: ${(err as Error).message}`);
      throw new ChupaError('SEND_FAILED', (err as Error).message, true);
    }
  }
}
