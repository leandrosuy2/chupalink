import type { WAMessage } from '../whatsapp/baileys';

export interface IncomingMessage {
  id: string;
  chatJid: string;
  isGroup: boolean;
  fromMe: boolean;
  /** JID do autor (em grupos: participante; prefere o número de telefone quando disponível). */
  sender?: string;
  senderName?: string;
  timestamp: Date;
  text: string;
  links: string[];
  raw: WAMessage;
}
