export type ChupaErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_PLATFORM'
  | 'BLOCKED_URL'
  | 'UNAVAILABLE'
  | 'PRIVATE'
  | 'LOGIN_REQUIRED'
  | 'NO_VIDEO'
  | 'TOO_LARGE'
  | 'TIMEOUT'
  | 'INTERRUPTED'
  | 'CORRUPTED'
  | 'RATE_LIMITED'
  | 'SEND_FAILED'
  | 'NOT_CONNECTED'
  | 'CANCELLED'
  | 'UNKNOWN';

/** Erro de domínio com código estável e indicação se vale a pena tentar novamente. */
export class ChupaError extends Error {
  constructor(
    public readonly code: ChupaErrorCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'ChupaError';
  }
}

/** Mensagens exibidas no grupo para cada tipo de falha. */
export const USER_ERROR_MESSAGES: Record<ChupaErrorCode, string> = {
  INVALID_URL: '❌ Esse link não parece válido.',
  UNSUPPORTED_PLATFORM: '🚫 Ainda não sei baixar vídeos dessa plataforma. Por enquanto: Instagram e TikTok.',
  BLOCKED_URL: '🚫 Esse endereço não é permitido.',
  UNAVAILABLE: '😕 Esse vídeo não está disponível (removido, inexistente ou bloqueado na região).',
  PRIVATE: '🔒 Esse conteúdo é privado ou protegido — não consigo baixar.',
  LOGIN_REQUIRED: '🔒 Não consegui acessar esse post — ele pode ser privado, ter sido removido ou exigir login.',
  NO_VIDEO: '🖼️ Esse post não tem vídeo.',
  TOO_LARGE: '📦 Esse vídeo é grande demais para eu enviar.',
  TIMEOUT: '⏱️ O download demorou demais e foi cancelado. Tente novamente mais tarde.',
  INTERRUPTED: '⚠️ O download foi interrompido. Tente novamente.',
  CORRUPTED: '⚠️ O arquivo baixado veio corrompido. Tente novamente.',
  RATE_LIMITED: '🐢 A plataforma limitou os downloads por agora. Tente de novo em alguns minutos.',
  SEND_FAILED: '⚠️ Baixei o vídeo, mas não consegui enviar aqui no grupo.',
  NOT_CONNECTED: '⚠️ Estou sem conexão com o WhatsApp no momento.',
  CANCELLED: '🛑 Download cancelado.',
  UNKNOWN: '⚠️ Algo deu errado ao processar esse link.',
};

export function toChupaError(err: unknown): ChupaError {
  if (err instanceof ChupaError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ChupaError('UNKNOWN', message, true);
}
