import { writeFileSync } from 'fs';
import { join } from 'path';
import { makeWASocket, sockets } from '../mocks/baileys.mock';
import { SessionsService } from '../../src/modules/sessions/sessions.service';
import { WhatsappConnection } from '../../src/modules/whatsapp/whatsapp.connection';
import { WhatsappEvents } from '../../src/modules/whatsapp/whatsapp.events';
import { ConnectionStatus, WA_EVENTS } from '../../src/modules/whatsapp/whatsapp.types';
import { flush, testConfig, waitFor } from '../helpers';

const closeWith = (code: number) => ({ connection: 'close', lastDisconnect: { error: Object.assign(new Error(`code ${code}`), { output: { statusCode: code } }), date: new Date() } });

function setup(withSession = false) {
  const config = testConfig({ WHATSAPP_QR_MAX_CYCLES: '2' });
  const sessions = new SessionsService(config);
  const events = new WhatsappEvents();
  const conn = new WhatsappConnection(config, sessions, events);
  const emitted: string[] = [];
  for (const ev of Object.values(WA_EVENTS)) events.on(ev as any, () => emitted.push(ev));
  return { config, sessions, events, conn, emitted, withSession, async seed() {
    const dir = await sessions.ensureSessionDir();
    writeFileSync(join(dir, 'creds.json'), JSON.stringify({ me: { id: '5511999999999:3@s.whatsapp.net', name: 'Bot' } }));
  } };
}

describe('WhatsappConnection', () => {
  afterEach(() => jest.useRealTimers());
  beforeEach(() => {
    sockets.length = 0;
    makeWASocket.mockClear();
  });

  it('sem sessão: gera QR Code e o atualiza quando expira', async () => {
    const { conn, emitted } = setup();
    await conn.start();
    expect(conn.getStatus()).toBe(ConnectionStatus.CONNECTING);
    sockets[0].emitUpdate({ qr: '2@primeiro-qr' });
    await waitFor(() => conn.getStatus() === ConnectionStatus.QR_CODE);
    const first = conn.getQr()!;
    expect(first.dataUrl).toMatch(/^data:image\/png;base64,/);

    sockets[0].emitUpdate({ qr: '2@segundo-qr' });
    await waitFor(() => conn.getQr()?.qr === '2@segundo-qr');
    expect(conn.getQr()!.qr).toBe('2@segundo-qr');
    expect(conn.getQr()!.dataUrl).not.toBe(first.dataUrl);
    expect(emitted.filter((e) => e === WA_EVENTS.QR)).toHaveLength(2);
    await conn.onApplicationShutdown();
  });

  it('com sessão salva: conecta sem QR Code', async () => {
    const ctx = setup();
    await ctx.seed();
    await ctx.conn.start();
    expect(ctx.conn.snapshot().hasSession).toBe(true);
    sockets[0].user = { id: '5511999999999:3@s.whatsapp.net', name: 'Bot' };
    sockets[0].emitUpdate({ connection: 'open' });
    await flush();
    expect(ctx.conn.getStatus()).toBe(ConnectionStatus.CONNECTED);
    expect(ctx.conn.getQr()).toBeUndefined();
    expect(ctx.emitted).toContain(WA_EVENTS.CONNECTED);
    expect(ctx.emitted).not.toContain(WA_EVENTS.QR);
    await ctx.conn.onApplicationShutdown();
  });

  it('não cria conexões duplicadas em chamadas concorrentes', async () => {
    const { conn } = setup();
    await Promise.all([conn.start(), conn.start(), conn.start()]);
    await conn.start();
    expect(makeWASocket).toHaveBeenCalledTimes(1);
    await conn.onApplicationShutdown();
  });

  it('restartRequired (após escanear o QR) reconecta imediatamente com novo socket', async () => {
    const ctx = setup();
    await ctx.seed();
    await ctx.conn.start();
    sockets[0].emitUpdate(closeWith(515));
    await waitFor(() => sockets.length === 2);
    expect(makeWASocket).toHaveBeenCalledTimes(2);
    expect(ctx.emitted).toContain(WA_EVENTS.RECONNECTING);
    sockets[1].emitUpdate({ connection: 'open' });
    await flush();
    expect(ctx.conn.getStatus()).toBe(ConnectionStatus.CONNECTED);
    await ctx.conn.onApplicationShutdown();
  });

  it('queda de rede: reconecta com backoff e preserva as credenciais', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    const ctx = setup();
    await ctx.seed();
    await ctx.conn.start();
    sockets[0].emitUpdate({ connection: 'open' });
    sockets[0].emitUpdate(closeWith(408));
    expect(ctx.conn.getStatus()).toBe(ConnectionStatus.RECONNECTING);
    expect(makeWASocket).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1500);
    expect(makeWASocket).toHaveBeenCalledTimes(1); // ainda dentro do backoff
    await jest.advanceTimersByTimeAsync(2000);
    jest.useRealTimers();
    await waitFor(() => makeWASocket.mock.calls.length === 2);
    expect(await ctx.sessions.hasValidCredentials()).toBe(true);
    await ctx.conn.onApplicationShutdown();
  });

  it('loggedOut: marca LOGGED_OUT, não reconecta e não apaga os arquivos', async () => {
    const ctx = setup();
    await ctx.seed();
    await ctx.conn.start();
    sockets[0].emitUpdate(closeWith(401));
    await new Promise((r) => setTimeout(r, 30));
    expect(ctx.conn.getStatus()).toBe(ConnectionStatus.LOGGED_OUT);
    expect(makeWASocket).toHaveBeenCalledTimes(1);
    expect(await ctx.sessions.hasValidCredentials()).toBe(true); // arquivos intactos
    // novo connect: sessão inválida vai para backup e um QR novo é pedido
    await ctx.conn.start();
    expect(makeWASocket).toHaveBeenCalledTimes(2);
    expect(ctx.conn.snapshot().hasSession).toBe(false);
    await ctx.conn.onApplicationShutdown();
  });

  it('para de gerar QR após o limite de ciclos sem leitura', async () => {
    const { conn } = setup();
    await conn.start();
    for (let i = 0; i < 2; i++) {
      await waitFor(() => sockets.length > i);
      sockets[i].emitUpdate({ qr: `qr-${i}` });
      await waitFor(() => conn.getStatus() === ConnectionStatus.QR_CODE);
      sockets[i].emitUpdate(closeWith(408));
      await waitFor(() => conn.getStatus() !== ConnectionStatus.QR_CODE);
    }
    expect(conn.getStatus()).toBe(ConnectionStatus.DISCONNECTED);
    expect(makeWASocket).toHaveBeenCalledTimes(2);
    await conn.onApplicationShutdown();
  });

  it('disconnect mantém a sessão; logout a remove', async () => {
    const ctx = setup();
    await ctx.seed();
    await ctx.conn.start();
    sockets[0].emitUpdate({ connection: 'open' });
    await ctx.conn.stop();
    expect(ctx.conn.getStatus()).toBe(ConnectionStatus.DISCONNECTED);
    expect(sockets[0].end).toHaveBeenCalled();
    expect(await ctx.sessions.hasValidCredentials()).toBe(true);

    await ctx.conn.start();
    sockets[1].emitUpdate({ connection: 'open' });
    await ctx.conn.logout();
    expect(sockets[1].logout).toHaveBeenCalled();
    expect(await ctx.sessions.hasValidCredentials()).toBe(false);
  });
});
