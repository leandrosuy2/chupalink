import { Injectable } from '@nestjs/common';
import { extractLinks } from '../../common/utils/links';
import type { WAMessage } from '../whatsapp/baileys';
import { IncomingMessage } from './messages.types';

/** Remove os "envelopes" de mensagem (temporária, visualização única, editada...). */
function unwrap(message: any): any {
  let m = message;
  for (let i = 0; i < 5 && m; i++) {
    const inner =
      m.ephemeralMessage?.message ??
      m.viewOnceMessage?.message ??
      m.viewOnceMessageV2?.message ??
      m.viewOnceMessageV2Extension?.message ??
      m.documentWithCaptionMessage?.message ??
      m.editedMessage?.message ??
      m.protocolMessage?.editedMessage;
    if (!inner) break;
    m = inner;
  }
  return m;
}

export function extractText(message: any): string {
  const m = unwrap(message);
  if (!m) return '';
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    m.buttonsResponseMessage?.selectedDisplayText ??
    m.templateButtonReplyMessage?.selectedDisplayText ??
    ''
  );
}

function toDate(ts: unknown): Date {
  const n = typeof ts === 'number' ? ts : Number((ts as any)?.toString?.() ?? 0);
  return n > 0 ? new Date(n * 1000) : new Date();
}

/** Converte uma mensagem crua do Baileys em um formato simples para o processador. */
@Injectable()
export class MessagesService {
  parse(msg: WAMessage): IncomingMessage | undefined {
    const key = msg.key;
    if (!key?.remoteJid || !key.id || !msg.message) return undefined;
    const chatJid = key.remoteJid;
    const isGroup = chatJid.endsWith('@g.us');
    const text = extractText(msg.message);
    const k = key as typeof key & { participantAlt?: string; remoteJidAlt?: string };
    return {
      id: key.id,
      chatJid,
      isGroup,
      fromMe: !!key.fromMe,
      sender: isGroup ? (k.participantAlt ?? key.participant ?? undefined) : (k.remoteJidAlt ?? chatJid),
      senderName: msg.pushName ?? undefined,
      timestamp: toDate(msg.messageTimestamp),
      text,
      links: extractLinks(text),
      raw: msg,
    };
  }
}
