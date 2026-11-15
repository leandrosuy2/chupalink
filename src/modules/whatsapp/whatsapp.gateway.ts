import { Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { APP_CONFIG, AppConfig } from '../../config/configuration';
import { extractToken, tokensMatch } from '../../common/utils/token';
import { WhatsappConnection } from './whatsapp.connection';
import { WhatsappEvents } from './whatsapp.events';
import { WA_EVENTS } from './whatsapp.types';

/**
 * Socket.IO: envia status e QR Code em tempo real.
 * Conexão exige o API_TOKEN em `auth.token` (ou header Authorization) — o QR Code é sensível.
 */
@WebSocketGateway({ cors: { origin: false } })
export class WhatsappGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  private readonly logger = new Logger('Gateway');
  private unsubscribers: Array<() => void> = [];

  @WebSocketServer()
  server: Server;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly events: WhatsappEvents,
    private readonly connection: WhatsappConnection,
  ) {}

  afterInit(server: Server) {
    server.use((socket, next) => {
      const token = (socket.handshake.auth?.token as string | undefined) ?? extractToken(socket.handshake.headers);
      if (!tokensMatch(token, this.config.apiToken)) return next(new Error('unauthorized'));
      next();
    });

    const forward = [
      WA_EVENTS.STATUS,
      WA_EVENTS.CONNECTED,
      WA_EVENTS.DISCONNECTED,
      WA_EVENTS.RECONNECTING,
      WA_EVENTS.LOGGED_OUT,
      WA_EVENTS.ERROR,
    ] as const;
    for (const ev of forward) this.unsubscribers.push(this.events.on(ev, (p) => this.server.emit(ev, p)));
    this.unsubscribers.push(
      this.events.on(WA_EVENTS.QR, (qr) =>
        this.server.emit(WA_EVENTS.QR, { dataUrl: qr.dataUrl, generatedAt: qr.generatedAt, cycle: qr.cycle }),
      ),
    );
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Cliente conectado ${client.id}`);
    // estado inicial imediato para quem acabou de abrir a página
    client.emit(WA_EVENTS.STATUS, this.connection.snapshot());
    const qr = this.connection.getQr();
    if (qr) client.emit(WA_EVENTS.QR, { dataUrl: qr.dataUrl, generatedAt: qr.generatedAt, cycle: qr.cycle });
  }

  /** Permite que outros módulos (ex.: jobs) publiquem eventos aos clientes. */
  broadcast(event: string, payload: unknown) {
    this.server?.emit(event, payload);
  }

  onModuleDestroy() {
    this.unsubscribers.forEach((u) => u());
  }
}
