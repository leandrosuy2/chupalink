import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'fs';
import { promises as fs } from 'fs';
import { hostname } from 'os';
import { join } from 'path';
import { APP_CONFIG, AppConfig } from '../../config/configuration';
import { SessionInfo } from './sessions.types';

interface LockData {
  pid: number;
  host: string;
  startedAt: string;
}

/**
 * Responsável pelo armazenamento físico das sessões do WhatsApp em disco.
 * As credenciais ficam em <WHATSAPP_SESSION_PATH>/<nome>/ (creds.json, chaves, etc.).
 * Nada aqui apaga uma sessão automaticamente: só logout explícito ou invalidação (que move para backup).
 */
@Injectable()
export class SessionsService implements OnApplicationShutdown {
  private readonly logger = new Logger(SessionsService.name);
  private readonly heldLocks = new Set<string>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    process.once('exit', () => this.releaseAllLocksSync());
  }

  get root(): string {
    return this.config.whatsapp.sessionRoot;
  }

  get defaultName(): string {
    return this.config.whatsapp.sessionName;
  }

  sessionDir(name = this.defaultName): string {
    this.assertValidName(name);
    return join(this.root, name);
  }

  private lockFile(name: string): string {
    return join(this.root, `${name}.lock`);
  }

  /** Cria a pasta da sessão (permissão 700 — só o dono do processo lê as credenciais). */
  async ensureSessionDir(name = this.defaultName): Promise<string> {
    const dir = this.sessionDir(name);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.chmod(this.root, 0o700).catch(() => undefined);
    await fs.chmod(dir, 0o700).catch(() => undefined);
    return dir;
  }

  /** Lê creds.json para saber se há uma conta pareada. */
  async readAccount(name = this.defaultName): Promise<SessionInfo['account'] | undefined> {
    try {
      const raw = await fs.readFile(join(this.sessionDir(name), 'creds.json'), 'utf8');
      const creds = JSON.parse(raw);
      if (!creds?.me?.id) return undefined;
      return { id: creds.me.id, name: creds.me.name, lid: creds.me.lid };
    } catch {
      return undefined;
    }
  }

  async hasValidCredentials(name = this.defaultName): Promise<boolean> {
    return !!(await this.readAccount(name));
  }

  async getInfo(name = this.defaultName): Promise<SessionInfo> {
    const dir = this.sessionDir(name);
    const exists = existsSync(dir);
    let files = 0;
    let sizeBytes = 0;
    let last = 0;
    if (exists) {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const st = await fs.stat(join(dir, entry.name));
        files++;
        sizeBytes += st.size;
        last = Math.max(last, st.mtimeMs);
      }
    }
    const account = await this.readAccount(name);
    return {
      name,
      path: dir,
      exists,
      authenticated: !!account,
      account,
      files,
      sizeBytes,
      lastUpdatedAt: last ? new Date(last).toISOString() : undefined,
      locked: this.heldLocks.has(name),
    };
  }

  async list(): Promise<SessionInfo[]> {
    const entries = await fs.readdir(this.root, { withFileTypes: true }).catch(() => []);
    const names = entries
      .filter((e) => e.isDirectory() && /^[a-zA-Z0-9_-]{1,64}$/.test(e.name))
      .map((e) => e.name);
    return Promise.all(names.map((n) => this.getInfo(n)));
  }

  /**
   * Impede que duas instâncias usem a mesma sessão ao mesmo tempo
   * (o WhatsApp derrubaria ambas com "connection replaced" e as chaves poderiam corromper).
   */
  acquireLock(name = this.defaultName): void {
    if (this.heldLocks.has(name)) return;
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const file = this.lockFile(name);
    const data: LockData = { pid: process.pid, host: hostname(), startedAt: new Date().toISOString() };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = openSync(file, 'wx', 0o600);
        writeSync(fd, JSON.stringify(data));
        closeSync(fd);
        this.heldLocks.add(name);
        return;
      } catch (err: any) {
        if (err.code !== 'EEXIST') throw err;
        const holder = this.readLock(file);
        if (holder && this.isAlive(holder)) {
          throw new Error(
            `A sessão "${name}" já está em uso pelo processo ${holder.pid} (${holder.host}) desde ${holder.startedAt}. ` +
              'Encerre a outra instância antes de iniciar esta.',
          );
        }
        this.logger.warn(`Removendo lock antigo da sessão "${name}" (processo ${holder?.pid ?? '?'} não existe mais)`);
        try {
          unlinkSync(file);
        } catch {
          /* outro processo pode ter removido */
        }
      }
    }
    throw new Error(`Não foi possível adquirir o lock da sessão "${name}"`);
  }

  releaseLock(name = this.defaultName): void {
    if (!this.heldLocks.has(name)) return;
    try {
      const holder = this.readLock(this.lockFile(name));
      if (holder?.pid === process.pid) unlinkSync(this.lockFile(name));
    } catch {
      /* já removido */
    }
    this.heldLocks.delete(name);
  }

  private releaseAllLocksSync() {
    for (const name of [...this.heldLocks]) this.releaseLock(name);
  }

  private readLock(file: string): LockData | undefined {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return undefined;
    }
  }

  private isAlive(lock: LockData): boolean {
    if (lock.host !== hostname()) return true; // outro host (volume compartilhado): respeita o lock
    if (lock.pid === process.pid) return false;
    try {
      process.kill(lock.pid, 0);
      return true;
    } catch (err: any) {
      return err.code === 'EPERM';
    }
  }

  /**
   * Sessão invalidada pelo WhatsApp (deslogada no celular): as credenciais não servem mais.
   * Em vez de apagar, move para um backup com timestamp e libera a pasta para um novo QR Code.
   */
  async archiveInvalidSession(name = this.defaultName): Promise<string | undefined> {
    const dir = this.sessionDir(name);
    if (!existsSync(dir)) return undefined;
    const target = join(this.root, '.invalid', `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    await fs.mkdir(join(this.root, '.invalid'), { recursive: true, mode: 0o700 });
    await fs.rename(dir, target);
    this.logger.warn(`Sessão "${name}" invalidada foi movida para ${target}`);
    return target;
  }

  /** Remove definitivamente a sessão (somente via logout confirmado). */
  async deleteSession(name = this.defaultName): Promise<void> {
    await fs.rm(this.sessionDir(name), { recursive: true, force: true });
    this.logger.warn(`Sessão "${name}" removida do disco`);
  }

  private assertValidName(name: string) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new Error(`Nome de sessão inválido: ${name}`);
  }

  onApplicationShutdown() {
    this.releaseAllLocksSync();
  }
}
