/**
 * Ponto único de importação do Baileys (v7, ESM). O Node 22 carrega ESM via require(),
 * e centralizar aqui permite substituir a biblioteca nos testes.
 */
export {
  makeWASocket,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  Browsers,
  isJidGroup,
  jidNormalizedUser,
} from '@whiskeysockets/baileys';
export type {
  WASocket,
  WAMessage,
  WAMessageKey,
  GroupMetadata,
  ConnectionState,
  AnyMessageContent,
  proto,
} from '@whiskeysockets/baileys';
