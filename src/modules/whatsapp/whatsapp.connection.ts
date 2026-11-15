import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { APP_CONFIG, AppConfig } from '../../config/configuration';
import { ChupaError } from '../../common/utils/errors';
import { getRootLogger } from '../../common/utils/logger';
import { SessionsService } from '../sessions/sessions.service';
import {
  AnyMessageContent,
  Browsers,
  ConnectionState,
  DisconnectReason,
  GroupMetadata,
  makeCacheableSignalKeyStore,
  makeWASocket,
  proto,
  useMultiFileAuthState,
  WAMessage,
  WAMessageKey,
  WASocket,
} from './baileys';
import { WhatsappEvents } from './whatsapp.events';
import { ConnectionSnapshot, ConnectionStatus, QrPayload, WA_EVENTS } from './whatsapp.types';

const MAX_BACKOFF_MS = 60_000;
const GROUP_CACHE_TTL_MS = 5 * 60_000;
const SENT_CACHE_SIZE = 500;
const MAX_BAD_SESSION_RETRIES = 5;

/**
 * Gerencia o ciclo de vida do socket Baileys:
 * autenticação persistida em disco, QR Code, reconexão com backoff e encerramento limpo.
 * Garante no máximo UM socket ativo por processo.
 */
@Injectable()
export class WhatsappConnection implements OnApplicationShutdown {
  private readonly logger = new Logger('WhatsApp');
  private sock?: WASocket;
  private status = ConnectionStatus.DISCONNECTED;
  private qr?: QrPayload;
  private qrCycles = 0;
  private reconnectAttempts = 0;
  private badSessionCount = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private starting?: Promise<void>;
  private manualStop = false;
  private shuttingDown = false;
  /** Incrementado a cada novo socket; eventos de sockets antigos são ignorados. */
  private generation = 0;
  private hasSession = false;
  private connectedAt?: Date;
  private lastDisconnect?: ConnectionSnapshot['lastDisconnect'];
  private readonly sentMessages = new Map<string, proto.IMessage>();
  private readonly groupCache = new Map<string, { meta: GroupMetadata; at: number }>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly sessions: SessionsService,
    private readonly events: WhatsappEvents,
  ) {}

  // ---------------------------------------------------------------- estado

  snapshot(): ConnectionSnapshot {
    const me = this.sock?.user;
    return {
      status: this.status,
      sessionName: this.sessions.defaultName,
      hasSession: this.hasSession,
      qrAvailable: !!this.qr && this.status === ConnectionStatus.QR_CODE,
      qrGeneratedAt: this.status === ConnectionStatus.QR_CODE ? this.qr?.generatedAt : undefined,
      connectedAt: this.status === ConnectionStatus.CONNECTED ? this.connectedAt?.toISOString() : undefined,
      lastDisconnect: this.lastDisconnect,
      reconnectAttempts: this.reconnectAttempts,
      user: me ? { id: me.id, name: me.name ?? me.notify ?? undefined, lid: me.lid ?? undefined } : undefined,
    };
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getQr(): QrPayload | undefined {
    return this.status === ConnectionStatus.QR_CODE ? this.qr : undefined;
  }

  isConnected(): boolean {
    return this.status === ConnectionStatus.CONNECTED && !!this.sock;
  }

  get socket(): WASocket {
    if (!this.sock || !this.isConnected()) throw new ChupaError('NOT_CONNECTED', 'WhatsApp não está conectado', true);
    return this.sock;
  }

  private setStatus(status: ConnectionStatus) {
    if (this.status === status) return;
    this.logger.log(`Status: ${this.status} → ${status}`);
    this.status = status;
    this.events.emit(WA_EVENTS.STATUS, this.snapshot());
  }

  // ---------------------------------------------------------------- ciclo de vida

  /**
   * Inicia a conexão se necessário. Idempotente: chamadas concorrentes reutilizam
   * a mesma tentativa e nunca criam dois sockets.
   */
  async start(): Promise<ConnectionSnapshot> {
    this.manualStop = false;
    if (this.starting) {
      await this.starting;
      return this.snapshot();
    }
    if (
      this.sock &&
      [ConnectionStatus.CONNECTED, ConnectionStatus.CONNECTING, ConnectionStatus.QR_CODE].includes(this.status)
    ) {
      return this.snapshot();
    }
    this.clearReconnectTimer();
    this.qrCycles = 0;
    this.starting = this.createSocket().finally(() => (this.starting = undefined));
    try {
      await this.starting;
    } catch (err) {
      this.fail(err);
    }
    return this.snapshot();
  }

  private async createSocket(): Promise<void> {
    this.teardownSocket();
    this.sessions.acquireLock();

    if (this.status === ConnectionStatus.LOGGED_OUT) {
      // credenciais foram invalidadas pelo WhatsApp: guarda backup e começa do zero (novo QR)
      await this.sessions.archiveInvalidSession();
    }

    const dir = await this.sessions.ensureSessionDir();
    const { state, saveCreds } = await useMultiFileAuthState(dir);
    this.hasSession = !!state.creds.me?.id;
    this.logger.log(
      this.hasSession
        ? `Sessão encontrada em ${dir} (${state.creds.me?.id}) — conectando sem QR Code`
        : `Nenhuma sessão em ${dir} — será gerado um QR Code`,
    );

    const gen = ++this.generation;
    this.setStatus(this.reconnectAttempts > 0 ? ConnectionStatus.RECONNECTING : ConnectionStatus.CONNECTING);

    // O Baileys emite muitos avisos internos inofensivos (ex.: "missing key ... to decode mutation"
    // na sincronização de estado de chats logo após o pareamento). Só mostramos erros, exceto em debug.
    const baileysLogger = getRootLogger().child(
      { module: 'baileys' },
      { level: ['debug', 'trace'].includes(this.config.log.level) ? 'info' : 'error' },
    );

    const sock = makeWASocket({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, baileysLogger as any) },
      logger: baileysLogger as any,
      browser: Browsers.ubuntu('ChupaLink'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      getMessage: async (key: WAMessageKey) => (key.id ? this.sentMessages.get(key.id) : undefined),
      cachedGroupMetadata: async (jid: string) => this.cachedGroup(jid),
    });
    this.sock = sock;

    // Persistência: toda atualização de credenciais é gravada em disco (creds.json).
    // As chaves (pre-keys, sender-keys, app-state) são gravadas pelo próprio keys.set do auth state.
    sock.ev.on('creds.update', () => {
      saveCreds().catch((err) => this.logger.error(`Falha ao salvar credenciais: ${err.message}`));
      if (state.creds.me?.id) this.hasSession = true;
    });

    sock.ev.on('connection.update', (update) => {
      if (gen !== this.generation) return;
      this.onConnectionUpdate(update, gen).catch((err) => this.logger.error(`Erro em connection.update: ${err.message}`));
    });

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (gen !== this.generation || type !== 'notify') return;
      for (const msg of messages) this.events.emit(WA_EVENTS.MESSAGE, msg);
    });

    sock.ev.on('groups.update', (updates) => updates.forEach((u) => u.id && this.groupCache.delete(u.id)));
    sock.ev.on('group-participants.update', ({ id }) => this.groupCache.delete(id));
  }

  private latestQr?: string;

  private async onConnectionUpdate(update: Partial<ConnectionState>, gen: number) {
    const { connection, lastDisconnect, qr } = update;

    if (connection === 'close') {
      this.latestQr = undefined;
      return this.onClose(lastDisconnect?.error);
    }

    if (qr) {
      this.latestQr = qr;
      const dataUrl = await QRCode.toDataURL(qr, { margin: 2, width: 320 });
      // descarta se, durante a geração, chegou um QR mais novo ou o socket foi trocado/fechado
      if (gen !== this.generation || this.latestQr !== qr || !this.sock) return;
      this.qr = { qr, dataUrl, generatedAt: new Date().toISOString(), cycle: this.qrCycles + 1 };
      this.setStatus(ConnectionStatus.QR_CODE);
      this.logger.log('QR Code gerado — escaneie em WhatsApp > Aparelhos conectados > Conectar um aparelho');
      this.events.emit(WA_EVENTS.QR, this.qr);
      if (this.config.env !== 'test') {
        QRCode.toString(qr, { type: 'terminal', small: true })
          .then((ascii) => process.stdout.write(`\n${ascii}\n`))
          .catch(() => undefined);
      }
    }

    if (connection === 'open') {
      this.latestQr = undefined;
      this.qr = undefined;
      this.qrCycles = 0;
      this.reconnectAttempts = 0;
      this.badSessionCount = 0;
      this.hasSession = true;
      this.connectedAt = new Date();
      this.setStatus(ConnectionStatus.CONNECTED);
      this.logger.log(`Conectado como ${this.sock?.user?.id}${update.isNewLogin ? ' (novo login)' : ''}`);
      this.events.emit(WA_EVENTS.CONNECTED, this.snapshot());
    }
  }

  private onClose(error: unknown) {
    const code: number | undefined = (error as any)?.output?.statusCode;
    const reason = (error as Error)?.message ?? 'conexão encerrada';
    const wasWaitingQr = this.status === ConnectionStatus.QR_CODE && !this.hasSession;
    this.lastDisconnect = { code, reason, at: new Date().toISOString() };
    this.qr = undefined;
    this.sock = undefined;
    this.logger.warn(`Conexão fechada (código ${code ?? '?'}): ${reason}`);

    if (this.manualStop || this.shuttingDown) {
      this.setStatus(ConnectionStatus.DISCONNECTED);
      this.events.emit(WA_EVENTS.DISCONNECTED, this.snapshot());
      return;
    }

    switch (code) {
      case DisconnectReason.loggedOut:
        // As credenciais não valem mais. NÃO apagamos nada aqui; no próximo connect a sessão
        // inválida é movida para backup e um novo QR Code é gerado.
        this.hasSession = false;
        this.setStatus(ConnectionStatus.LOGGED_OUT);
        this.logger.error('Sessão deslogada pelo WhatsApp — será necessário escanear um novo QR Code (POST /api/whatsapp/connect)');
        this.events.emit(WA_EVENTS.LOGGED_OUT, this.snapshot());
        return;

      case DisconnectReason.connectionReplaced:
        return this.fail(new Error('Sessão aberta em outro lugar (connection replaced). Reconexão automática suspensa.'));

      case DisconnectReason.forbidden:
        return this.fail(new Error('WhatsApp recusou a conexão (403). Verifique se o número não foi restringido.'));

      case DisconnectReason.restartRequired:
        // comportamento normal logo após escanear o QR Code
        return this.scheduleReconnect(0);

      case DisconnectReason.badSession:
        if (++this.badSessionCount > MAX_BAD_SESSION_RETRIES) {
          return this.fail(new Error('Sessão corrompida (badSession repetido). Faça logout e conecte novamente.'));
        }
        break;
    }

    if (wasWaitingQr) {
      this.qrCycles++;
      if (this.qrCycles >= this.config.whatsapp.qrMaxCycles) {
        this.logger.warn(`QR Code não foi escaneado após ${this.qrCycles} ciclos — aguardando POST /api/whatsapp/connect`);
        this.qrCycles = 0;
        this.setStatus(ConnectionStatus.DISCONNECTED);
        this.events.emit(WA_EVENTS.DISCONNECTED, this.snapshot());
        return;
      }
      return this.scheduleReconnect(0);
    }

    const delay = Math.min(MAX_BACKOFF_MS, 2000 * 2 ** this.reconnectAttempts) + Math.floor(Math.random() * 1000);
    this.scheduleReconnect(delay);
  }

  private scheduleReconnect(delayMs: number) {
    this.clearReconnectTimer();
    this.reconnectAttempts++;
    this.setStatus(ConnectionStatus.RECONNECTING);
    this.events.emit(WA_EVENTS.RECONNECTING, { ...this.snapshot(), delayMs });
    this.logger.log(`Reconectando em ${Math.round(delayMs / 1000)}s (tentativa ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.manualStop || this.shuttingDown) return;
      this.starting = this.createSocket().finally(() => (this.starting = undefined));
      this.starting.catch((err) => {
        this.logger.error(`Falha ao reconectar: ${err.message}`);
        this.scheduleReconnect(Math.min(MAX_BACKOFF_MS, 2000 * 2 ** this.reconnectAttempts));
      });
    }, delayMs);
  }

  private fail(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error(message);
    this.teardownSocket();
    this.setStatus(ConnectionStatus.ERROR);
    this.events.emit(WA_EVENTS.ERROR, { ...this.snapshot(), message });
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  /** Fecha o socket atual sem deslogar (as credenciais continuam válidas no disco). */
  private teardownSocket() {
    const sock = this.sock;
    this.generation++;
    this.sock = undefined;
    if (!sock) return;
    try {
      sock.end(undefined);
    } catch {
      /* socket já fechado */
    }
  }

  /** Desconecta mantendo a sessão salva. */
  async stop(): Promise<ConnectionSnapshot> {
    this.manualStop = true;
    this.clearReconnectTimer();
    this.teardownSocket();
    this.qr = undefined;
    this.reconnectAttempts = 0;
    this.setStatus(ConnectionStatus.DISCONNECTED);
    this.events.emit(WA_EVENTS.DISCONNECTED, this.snapshot());
    this.sessions.releaseLock();
    return this.snapshot();
  }

  /** Desvincula o aparelho no WhatsApp e apaga a sessão local. */
  async logout(): Promise<ConnectionSnapshot> {
    this.manualStop = true;
    this.clearReconnectTimer();
    const sock = this.sock;
    if (sock && this.isConnected()) {
      try {
        await sock.logout('Logout solicitado via ChupaLink API');
      } catch (err) {
        this.logger.warn(`logout remoto falhou (${(err as Error).message}); removendo sessão local mesmo assim`);
      }
    }
    this.teardownSocket();
    await this.sessions.deleteSession();
    this.hasSession = false;
    this.qr = undefined;
    this.reconnectAttempts = 0;
    this.sessions.releaseLock();
    this.setStatus(ConnectionStatus.LOGGED_OUT);
    this.events.emit(WA_EVENTS.LOGGED_OUT, this.snapshot());
    // após logout explícito não há o que arquivar: o próximo connect simplesmente gera QR
    this.status = ConnectionStatus.DISCONNECTED;
    this.events.emit(WA_EVENTS.STATUS, this.snapshot());
    return this.snapshot();
  }

  async onApplicationShutdown(signal?: string) {
    this.shuttingDown = true;
    this.clearReconnectTimer();
    if (this.sock) this.logger.log(`Encerrando conexão WhatsApp (${signal ?? 'shutdown'}) — sessão preservada em disco`);
    this.teardownSocket();
    this.sessions.releaseLock();
  }

  // ---------------------------------------------------------------- operações

  async sendMessage(jid: string, content: AnyMessageContent, options: { quoted?: WAMessage } = {}) {
    const sent = await this.socket.sendMessage(jid, content, { ...options, mediaUploadTimeoutMs: 5 * 60_000 });
    if (sent?.key.id && sent.message) {
      this.sentMessages.set(sent.key.id, sent.message);
      if (this.sentMessages.size > SENT_CACHE_SIZE) {
        this.sentMessages.delete(this.sentMessages.keys().next().value as string);
      }
    }
    return sent;
  }

  /** true se a mensagem foi enviada por ESTE bot (e não pelo celular do mesmo número). */
  wasSentByBot(messageId: string): boolean {
    return this.sentMessages.has(messageId);
  }

  private cachedGroup(jid: string): GroupMetadata | undefined {
    const hit = this.groupCache.get(jid);
    return hit && Date.now() - hit.at < GROUP_CACHE_TTL_MS ? hit.meta : undefined;
  }

  async groupMetadata(jid: string): Promise<GroupMetadata> {
    const cached = this.cachedGroup(jid);
    if (cached) return cached;
    const meta = await this.socket.groupMetadata(jid);
    this.groupCache.set(jid, { meta, at: Date.now() });
    return meta;
  }

  async fetchAllGroups(): Promise<GroupMetadata[]> {
    const all = await this.socket.groupFetchAllParticipating();
    const now = Date.now();
    for (const meta of Object.values(all)) this.groupCache.set(meta.id, { meta, at: now });
    return Object.values(all);
  }
}
