import { ChupaError } from '../../src/common/utils/errors';
import { JobsService } from '../../src/modules/jobs/jobs.service';
import { JobHandler, JobInput, JobStatus } from '../../src/modules/jobs/jobs.types';
import { testConfig, waitFor } from '../helpers';

const input = (n = 1, chat = 'g1@g.us'): JobInput => ({
  url: `https://www.tiktok.com/@a/video/${n}`,
  platform: 'tiktok',
  dedupeKey: `tiktok.com/@a/video/${n}`,
  chatJid: chat,
});

function make(handler: Partial<JobHandler>, env: Record<string, string> = {}) {
  const jobs = new JobsService(testConfig(env));
  jobs.retryDelayMs = 1;
  jobs.registerHandler({ process: async () => ({ files: [] }), ...handler } as JobHandler);
  return jobs;
}

describe('JobsService', () => {
  it('cria tarefa com ID único e conclui', async () => {
    const jobs = make({});
    const { job } = jobs.enqueue(input());
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(job.status).toBe(JobStatus.PENDING);
    await waitFor(() => jobs.get(job.id).status === JobStatus.COMPLETED);
    expect(jobs.get(job.id).history.map((h) => h.status)).toEqual([JobStatus.PENDING, JobStatus.PROCESSING, JobStatus.COMPLETED]);
  });

  it('impede duplicatas do mesmo vídeo no mesmo grupo enquanto ativa', () => {
    const jobs = make({ process: () => new Promise(() => undefined) });
    const a = jobs.enqueue(input(1));
    const b = jobs.enqueue(input(1));
    const c = jobs.enqueue(input(1, 'outro@g.us'));
    expect(b.duplicate).toBe(true);
    expect(b.job.id).toBe(a.job.id);
    expect(c.duplicate).toBe(false);
  });

  it('respeita o limite de concorrência (sequencial por padrão)', async () => {
    let running = 0;
    let max = 0;
    const jobs = make({
      process: async () => {
        running++;
        max = Math.max(max, running);
        await new Promise((r) => setTimeout(r, 20));
        running--;
        return { files: [] };
      },
    });
    const ids = [1, 2, 3].map((n) => jobs.enqueue(input(n)).job.id);
    await waitFor(() => ids.every((id) => jobs.get(id).status === JobStatus.COMPLETED));
    expect(max).toBe(1);
  });

  it('tenta novamente só erros recuperáveis e chama onFailed uma vez', async () => {
    const onFailed = jest.fn(async () => undefined);
    const process = jest.fn(async () => {
      throw new ChupaError('INTERRUPTED', 'rede caiu', true);
    });
    const jobs = make({ process, onFailed }, { DOWNLOAD_MAX_ATTEMPTS: '3' });
    const { job } = jobs.enqueue(input());
    await waitFor(() => jobs.get(job.id).status === JobStatus.FAILED);
    expect(process).toHaveBeenCalledTimes(3);
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(jobs.get(job.id).error).toMatchObject({ code: 'INTERRUPTED' });
  });

  it('não repete erros definitivos (ex.: conteúdo privado)', async () => {
    const process = jest.fn(async () => {
      throw new ChupaError('PRIVATE', 'privado');
    });
    const jobs = make({ process }, { DOWNLOAD_MAX_ATTEMPTS: '3' });
    const { job } = jobs.enqueue(input());
    await waitFor(() => jobs.get(job.id).status === JobStatus.FAILED);
    expect(process).toHaveBeenCalledTimes(1);
  });

  it('cancela tarefa pendente e em andamento', async () => {
    const jobs = make({
      process: (_job, _ctx, run) =>
        new Promise((_, reject) => run.signal.addEventListener('abort', () => reject(new Error('abortado')))),
    });
    const running = jobs.enqueue(input(1)).job;
    const pending = jobs.enqueue(input(2)).job;
    await waitFor(() => jobs.get(running.id).status === JobStatus.PROCESSING);
    jobs.cancel(pending.id);
    expect(jobs.get(pending.id).status).toBe(JobStatus.CANCELLED);
    jobs.cancel(running.id);
    await waitFor(() => jobs.get(running.id).status === JobStatus.CANCELLED);
    expect(() => jobs.cancel(running.id)).toThrow(/já finalizada/);
  });

  it('encontra tarefa concluída recentemente para evitar reenvio', async () => {
    const jobs = make({});
    const { job } = jobs.enqueue(input(9));
    await waitFor(() => jobs.get(job.id).status === JobStatus.COMPLETED);
    expect(jobs.findRecentCompleted('g1@g.us', input(9).dedupeKey, 60_000)?.id).toBe(job.id);
    expect(jobs.findRecentCompleted('g1@g.us', input(8).dedupeKey, 60_000)).toBeUndefined();
  });
});
