import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'fs';
import { hostname } from 'os';
import { join } from 'path';
import { SessionsService } from '../../src/modules/sessions/sessions.service';
import { testConfig } from '../helpers';

describe('SessionsService', () => {
  it('cria a pasta da sessão com permissão 700', async () => {
    const config = testConfig();
    const svc = new SessionsService(config);
    const dir = await svc.ensureSessionDir();
    expect(dir).toBe(join(config.whatsapp.sessionRoot, 'chupalink'));
    expect(existsSync(dir)).toBe(true);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('detecta sessão existente e autenticada a partir do creds.json', async () => {
    const config = testConfig();
    const svc = new SessionsService(config);
    const dir = await svc.ensureSessionDir();
    expect(await svc.hasValidCredentials()).toBe(false);
    writeFileSync(join(dir, 'creds.json'), JSON.stringify({ me: { id: '5511999999999:1@s.whatsapp.net', name: 'Bot' } }));
    writeFileSync(join(dir, 'pre-key-1.json'), '{}');
    const info = await svc.getInfo();
    expect(info).toMatchObject({ exists: true, authenticated: true, files: 2, account: { id: '5511999999999:1@s.whatsapp.net' } });
  });

  it('impede duas instâncias na mesma sessão', () => {
    const config = testConfig();
    const a = new SessionsService(config);
    a.acquireLock();
    // simula outro processo vivo (o pai do jest) segurando o lock
    mkdirSync(config.whatsapp.sessionRoot, { recursive: true });
    writeFileSync(
      join(config.whatsapp.sessionRoot, 'chupalink.lock'),
      JSON.stringify({ pid: process.ppid, host: hostname(), startedAt: new Date().toISOString() }),
    );
    const b = new SessionsService(config);
    expect(() => b.acquireLock()).toThrow(/já está em uso/);
  });

  it('assume lock antigo de processo que não existe mais', () => {
    const config = testConfig();
    mkdirSync(config.whatsapp.sessionRoot, { recursive: true });
    writeFileSync(
      join(config.whatsapp.sessionRoot, 'chupalink.lock'),
      JSON.stringify({ pid: 2 ** 22 - 7, host: hostname(), startedAt: '2020-01-01' }),
    );
    const svc = new SessionsService(config);
    expect(() => svc.acquireLock()).not.toThrow();
    svc.releaseLock();
    expect(existsSync(join(config.whatsapp.sessionRoot, 'chupalink.lock'))).toBe(false);
  });

  it('sessão invalidada é movida para backup, nunca apagada', async () => {
    const config = testConfig();
    const svc = new SessionsService(config);
    const dir = await svc.ensureSessionDir();
    writeFileSync(join(dir, 'creds.json'), '{}');
    const backup = await svc.archiveInvalidSession();
    expect(existsSync(dir)).toBe(false);
    expect(readdirSync(backup!)).toContain('creds.json');
  });
});
