import { spawn } from 'child_process';
import { ChupaError } from './errors';

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface RunOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Limite de bytes guardados de stdout/stderr (evita uso excessivo de memória). */
  maxBuffer?: number;
  cwd?: string;
  /** Chamado a cada linha completa de stdout/stderr (ex.: progresso do yt-dlp). */
  onLine?: (line: string) => void;
}

/**
 * Executa um binário externo SEM shell, com argumentos separados.
 * Nunca concatene URLs em strings de comando — passe-as em `args`.
 */
export function runProcess(command: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const maxBuffer = opts.maxBuffer ?? 20 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new ChupaError('CANCELLED', 'Operação cancelada'));
    const child = spawn(command, args, {
      shell: false,
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let stdout = '';
    let stderr = '';
    let finished = false;
    let timedOut = false;
    let aborted = false;
    const partial = { out: '', err: '' };
    const feed = (kind: 'out' | 'err', chunk: string) => {
      if (!opts.onLine) return;
      const lines = (partial[kind] + chunk).split(/\r?\n|\r/);
      partial[kind] = lines.pop() ?? '';
      for (const l of lines) if (l) opts.onLine(l);
    };

    child.stdout.on('data', (d: Buffer) => {
      const text = d.toString('utf8');
      feed('out', text);
      if (stdout.length < maxBuffer) stdout += text;
    });
    child.stderr.on('data', (d: Buffer) => {
      const text = d.toString('utf8');
      feed('err', text);
      if (stderr.length < maxBuffer) stderr += text;
      // mantém só o final do stderr, que é onde ficam os erros
      if (stderr.length > maxBuffer) stderr = stderr.slice(-maxBuffer / 2);
    });

    const kill = () => {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 5000).unref();
      }
    };
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          kill();
        }, opts.timeoutMs)
      : undefined;
    const onAbort = () => {
      aborted = true;
      kill();
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const done = (fn: () => void) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      fn();
    };

    child.on('error', (err: NodeJS.ErrnoException) =>
      done(() =>
        reject(
          err.code === 'ENOENT'
            ? new ChupaError('UNKNOWN', `Executável não encontrado: ${command}. Verifique a instalação.`)
            : err,
        ),
      ),
    );
    child.on('close', (code) =>
      done(() => {
        if (timedOut) return reject(new ChupaError('TIMEOUT', `${command} excedeu o tempo limite`, false));
        if (aborted) return reject(new ChupaError('CANCELLED', 'Operação cancelada'));
        resolve({ stdout, stderr, code });
      }),
    );
  });
}
