import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { APP_CONFIG, AppConfig } from '../../config/configuration';
import { ChupaError, toChupaError } from '../../common/utils/errors';
import { ACTIVE_STATUSES, FINAL_STATUSES, Job, JobHandler, JobInput, JobStatus } from './jobs.types';

interface Entry {
  job: Job;
  context: unknown;
  controller?: AbortController;
}

const HISTORY_LIMIT = 500;

/**
 * Fila em memória com concorrência limitada (DOWNLOAD_CONCURRENCY), timeout,
 * novas tentativas só para erros recuperáveis, cancelamento e prevenção de duplicatas.
 */
@Injectable()
export class JobsService implements OnApplicationShutdown {
  private readonly logger = new Logger('Jobs');
  private readonly entries = new Map<string, Entry>();
  private readonly queue: string[] = [];
  private running = 0;
  private handler?: JobHandler;
  private readonly listeners = new Set<(job: Job) => void>();
  private shuttingDown = false;
  /** Tempo máximo total de uma tentativa (download + conversão + envio). */
  private readonly jobTimeoutMs: number;
  retryDelayMs = 5_000;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.jobTimeoutMs = config.download.timeoutMs * 2 + 5 * 60_000;
  }

  registerHandler(handler: JobHandler) {
    this.handler = handler;
    this.tick();
  }

  onUpdate(listener: (job: Job) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Enfileira; se o mesmo vídeo já estiver em andamento no mesmo chat, retorna a tarefa existente. */
  enqueue(input: JobInput): { job: Job; duplicate: boolean; position: number } {
    const active = this.findActive(input.chatJid, input.dedupeKey);
    if (active) return { job: active, duplicate: true, position: this.queue.indexOf(active.id) };

    const now = new Date().toISOString();
    const { context, ...data } = input;
    const job: Job = {
      ...data,
      id: randomUUID(),
      status: JobStatus.PENDING,
      attempts: 0,
      maxAttempts: this.config.download.maxAttempts,
      createdAt: now,
      history: [{ status: JobStatus.PENDING, at: now }],
    };
    this.entries.set(job.id, { job, context });
    this.queue.push(job.id);
    const position = this.queue.length - 1 + this.running;
    this.logger.log(`Tarefa ${job.id} criada (${job.platform}) ${job.url} — posição ${position}`);
    this.notify(job);
    this.prune();
    setImmediate(() => this.tick());
    return { job, duplicate: false, position };
  }

  findActive(chatJid: string, dedupeKey: string): Job | undefined {
    for (const { job } of this.entries.values()) {
      if (job.chatJid === chatJid && job.dedupeKey === dedupeKey && ACTIVE_STATUSES.includes(job.status)) return job;
    }
    return undefined;
  }

  findRecentCompleted(chatJid: string, dedupeKey: string, windowMs: number): Job | undefined {
    const limit = Date.now() - windowMs;
    for (const { job } of this.entries.values()) {
      if (
        job.chatJid === chatJid &&
        job.dedupeKey === dedupeKey &&
        job.status === JobStatus.COMPLETED &&
        job.finishedAt &&
        Date.parse(job.finishedAt) >= limit
      ) {
        return job;
      }
    }
    return undefined;
  }

  list(filter: { status?: JobStatus; limit?: number } = {}): Job[] {
    const all = [...this.entries.values()].map((e) => e.job).reverse();
    const filtered = filter.status ? all.filter((j) => j.status === filter.status) : all;
    return filtered.slice(0, filter.limit ?? 100);
  }

  get(id: string): Job {
    const entry = this.entries.get(id);
    if (!entry) throw new NotFoundException(`Tarefa ${id} não encontrada`);
    return entry.job;
  }

  stats() {
    const counts = Object.fromEntries(Object.values(JobStatus).map((s) => [s, 0])) as Record<JobStatus, number>;
    for (const { job } of this.entries.values()) counts[job.status]++;
    return { running: this.running, queued: this.queue.length, concurrency: this.config.download.concurrency, counts };
  }

  cancel(id: string): Job {
    const entry = this.entries.get(id);
    if (!entry) throw new NotFoundException(`Tarefa ${id} não encontrada`);
    const { job } = entry;
    if (FINAL_STATUSES.includes(job.status)) throw new BadRequestException(`Tarefa já finalizada (${job.status})`);
    if (job.status === JobStatus.PENDING) {
      this.queue.splice(this.queue.indexOf(id), 1);
      this.finish(job, JobStatus.CANCELLED, 'cancelada antes de iniciar');
    } else {
      entry.controller?.abort(new ChupaError('CANCELLED', 'Cancelada via API'));
    }
    return job;
  }

  private tick() {
    if (!this.handler || this.shuttingDown) return;
    while (this.running < this.config.download.concurrency && this.queue.length) {
      const id = this.queue.shift()!;
      const entry = this.entries.get(id);
      if (!entry || entry.job.status !== JobStatus.PENDING) continue;
      this.running++;
      this.run(entry)
        .catch((err) => this.logger.error(`Erro inesperado na tarefa ${id}: ${err?.message}`))
        .finally(() => {
          this.running--;
          this.tick();
        });
    }
  }

  private async run(entry: Entry) {
    const { job } = entry;
    job.startedAt = new Date().toISOString();

    while (job.attempts < job.maxAttempts) {
      job.attempts++;
      const controller = new AbortController();
      entry.controller = controller;
      const timer = setTimeout(
        () => controller.abort(new ChupaError('TIMEOUT', 'Tempo limite da tarefa excedido')),
        this.jobTimeoutMs,
      );
      this.setStatus(job, JobStatus.PROCESSING, `tentativa ${job.attempts}/${job.maxAttempts}`);
      try {
        const result = await this.handler!.process(job, entry.context, {
          signal: controller.signal,
          attempt: job.attempts,
          setStatus: (status, note) => {
            if (controller.signal.aborted) throw controller.signal.reason ?? new ChupaError('CANCELLED', 'Cancelada');
            this.setStatus(job, status, note);
          },
        });
        job.result = result;
        job.error = undefined;
        this.finish(job, JobStatus.COMPLETED);
        return;
      } catch (raw) {
        // se foi abortado, o motivo real (TIMEOUT/CANCELLED) prevalece sobre o erro do processo
        const err = controller.signal.aborted ? toChupaError(controller.signal.reason ?? raw) : toChupaError(raw);
        job.error = { code: err.code, message: err.message };
        if (err.code === 'CANCELLED') {
          this.finish(job, JobStatus.CANCELLED, err.message);
          return;
        }
        const willRetry = err.retryable && job.attempts < job.maxAttempts && !this.shuttingDown;
        this.logger.warn(
          `Tarefa ${job.id} falhou (${err.code}) na tentativa ${job.attempts}: ${err.message}${willRetry ? ' — tentando novamente' : ''}`,
        );
        if (!willRetry) break;
        await new Promise((r) => setTimeout(r, this.retryDelayMs * job.attempts));
      } finally {
        clearTimeout(timer);
        entry.controller = undefined;
      }
    }

    const context = entry.context; // finish() libera o contexto da memória
    this.finish(job, JobStatus.FAILED, job.error?.message);
    await this.handler!.onFailed?.(job, context).catch((e) =>
      this.logger.error(`onFailed da tarefa ${job.id} falhou: ${e?.message}`),
    );
  }

  private setStatus(job: Job, status: JobStatus, note?: string) {
    job.status = status;
    job.history.push({ status, at: new Date().toISOString(), note });
    this.logger.log(`Tarefa ${job.id}: ${status}${note ? ` (${note})` : ''}`);
    this.notify(job);
  }

  private finish(job: Job, status: JobStatus, note?: string) {
    job.finishedAt = new Date().toISOString();
    job.durationMs = job.startedAt ? Date.parse(job.finishedAt) - Date.parse(job.startedAt) : 0;
    this.setStatus(job, status, note);
    const entry = this.entries.get(job.id);
    if (entry) entry.context = undefined; // libera a mensagem original da memória
  }

  private notify(job: Job) {
    for (const l of this.listeners) {
      try {
        l(job);
      } catch {
        /* listener não deve derrubar a fila */
      }
    }
  }

  /** Mantém só as últimas HISTORY_LIMIT tarefas finalizadas em memória. */
  private prune() {
    if (this.entries.size <= HISTORY_LIMIT) return;
    for (const [id, { job }] of this.entries) {
      if (this.entries.size <= HISTORY_LIMIT) break;
      if (FINAL_STATUSES.includes(job.status)) this.entries.delete(id);
    }
  }

  onApplicationShutdown() {
    this.shuttingDown = true;
    for (const entry of this.entries.values()) entry.controller?.abort(new ChupaError('CANCELLED', 'API encerrando'));
  }
}
