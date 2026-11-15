/** Substituto do Baileys nos testes (o pacote real é ESM e abriria conexão com o WhatsApp). */
import { EventEmitter } from 'events';

export enum DisconnectReason {
  connectionClosed = 428,
  connectionLost = 408,
  connectionReplaced = 440,
  timedOut = 408,
  loggedOut = 401,
  badSession = 500,
  restartRequired = 515,
  multideviceMismatch = 411,
  forbidden = 403,
  unavailableService = 503,
}

export const Browsers = { ubuntu: (b: string) => ['Ubuntu', b, '22.04'] };
export const isJidGroup = (jid?: string) => !!jid?.endsWith('@g.us');
export const jidNormalizedUser = (jid?: string) => jid ?? '';
export const makeCacheableSignalKeyStore = (keys: unknown) => keys;

export class FakeSocket {
  ev = new EventEmitter();
  user?: { id: string; name?: string; lid?: string };
  ended = false;
  sent: Array<{ jid: string; content: any; options: any }> = [];
  end = jest.fn(() => {
    this.ended = true;
  });
  logout = jest.fn(async () => undefined);
  sendMessage = jest.fn(async (jid: string, content: any, options: any) => {
    this.sent.push({ jid, content, options });
    return { key: { id: `sent-${this.sent.length}`, remoteJid: jid, fromMe: true }, message: { conversation: 'x' } };
  });
  groupMetadata = jest.fn(async (jid: string) => ({ id: jid, subject: 'Grupo Teste', participants: [] }));
  groupFetchAllParticipating = jest.fn(async () => ({}));
  profilePictureUrl = jest.fn(async () => undefined);
  fetchStatus = jest.fn(async () => undefined);
  emitUpdate(update: any) {
    this.ev.emit('connection.update', update);
  }
}

export const sockets: FakeSocket[] = [];
export const makeWASocket = jest.fn((_config: any) => {
  const s = new FakeSocket();
  sockets.push(s);
  return s;
});

/** Simula o useMultiFileAuthState gravando creds.json de verdade no disco. */
export const useMultiFileAuthState = jest.fn(async (folder: string) => {
  const fs = await import('fs');
  const path = await import('path');
  const file = path.join(folder, 'creds.json');
  const creds = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { registered: false };
  return {
    state: { creds, keys: {} },
    saveCreds: async () => fs.writeFileSync(file, JSON.stringify(creds)),
  };
});

export default makeWASocket;
