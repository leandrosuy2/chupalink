import type { ChupaErrorCode } from '../../common/utils/errors';

export enum JobStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  DOWNLOADING = 'DOWNLOADING',
  SENDING = 'SENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export const ACTIVE_STATUSES = [JobStatus.PENDING, JobStatus.PROCESSING, JobStatus.DOWNLOADING, JobStatus.SENDING];
export const FINAL_STATUSES = [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED];

export interface JobInput {
  url: string;
  platform: string;
  /** Chave para detectar o mesmo vídeo (ex.: tiktok.com/@u/video/123). */
  dedupeKey: string;
  chatJid: string;
  chatName?: string;
  sender?: string;
  senderName?: string;
  messageId?: string;
  /** Dados livres para o handler (ex.: a mensagem original para responder). Não exposto na API. */
  context?: unknown;
}

export interface JobResultFile {
  fileName: string;
  sizeBytes: number;
  durationSec: number;
  sentAs: 'video' | 'document';
  transcoded: boolean;
}

export interface JobResult {
  title?: string;
  uploader?: string;
  files: JobResultFile[];
}

export interface Job extends Omit<JobInput, 'context'> {
  id: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  error?: { code: ChupaErrorCode; message: string };
  result?: JobResult;
  history: Array<{ status: JobStatus; at: string; note?: string }>;
}

export interface JobRunContext {
  signal: AbortSignal;
  attempt: number;
  setStatus(status: JobStatus.PROCESSING | JobStatus.DOWNLOADING | JobStatus.SENDING, note?: string): void;
}

export interface JobHandler {
  process(job: Job, context: unknown, run: JobRunContext): Promise<JobResult>;
  /** Chamado uma única vez quando a tarefa falha definitivamente (sem novas tentativas). */
  onFailed?(job: Job, context: unknown): Promise<void>;
}
