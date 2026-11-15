export type Platform = 'instagram' | 'tiktok' | 'direct' | (string & {});

export interface VideoInfo {
  platform: Platform;
  id: string;
  /** URL original enviada no grupo. */
  url: string;
  title?: string;
  uploader?: string;
  durationSec?: number;
  filesizeApprox?: number;
  thumbnail?: string;
  /** Quantidade de vídeos no link (carrossel do Instagram pode ter vários). */
  itemCount: number;
}

export interface DownloadContext {
  /** Pasta exclusiva da tarefa; é apagada ao final. */
  workDir: string;
  signal: AbortSignal;
  maxBytes: number;
  timeoutMs: number;
  maxItems: number;
  /** Seletor de formato opcional (sintaxe do yt-dlp). */
  format?: string;
  /** Progresso do download (chamado com frequência; quem recebe deve limitar a taxa). */
  onProgress?: (p: DownloadProgress) => void;
}

export interface DownloadProgress {
  /** Item atual (1-based) e total — carrossel do Instagram pode ter vários. */
  item: number;
  items: number;
  downloadedBytes: number;
  totalBytes?: number;
  /** 0–100, quando o tamanho total é conhecido. */
  percent?: number;
}

/**
 * Contrato de um provedor de download. Para suportar uma nova plataforma basta
 * implementar esta interface e registrá-la em VIDEO_PROVIDERS (downloader.module.ts).
 */
export interface VideoProvider {
  readonly platform: Platform;
  /** Prioridade na escolha (maior primeiro) — provedores específicos antes de genéricos. */
  readonly priority: number;
  supports(url: URL): boolean;
  getInfo(url: string, ctx: DownloadContext): Promise<VideoInfo>;
  /** Baixa para ctx.workDir e retorna os caminhos dos arquivos de vídeo baixados. */
  download(url: string, ctx: DownloadContext, info: VideoInfo): Promise<string[]>;
}

export const VIDEO_PROVIDERS = Symbol('VIDEO_PROVIDERS');

export interface MediaProbe {
  durationSec: number;
  sizeBytes: number;
  formatName: string;
  video?: { codec: string; width: number; height: number; pixFmt?: string };
  audio?: { codec: string };
}

export interface PreparedVideo {
  path: string;
  fileName: string;
  mimetype: string;
  sizeBytes: number;
  durationSec: number;
  width?: number;
  height?: number;
  transcoded: boolean;
}

export interface DownloadResult {
  info: VideoInfo;
  files: PreparedVideo[];
}

export type DownloadStage = 'info' | 'downloading' | 'converting' | 'processing';
