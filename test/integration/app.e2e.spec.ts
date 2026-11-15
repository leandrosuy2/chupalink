import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { sockets } from '../mocks/baileys.mock';
import { AppModule } from '../../src/app.module';
import { setupApp } from '../../src/app.setup';
import { tempDir, waitFor } from '../helpers';

const TOKEN = 'token-de-teste-e2e-1234567890';
const auth = { Authorization: `Bearer ${TOKEN}` };

describe('ChupaLink API (integração)', () => {
  let app: INestApplication;
  let root: string;

  beforeAll(async () => {
    root = tempDir();
    Object.assign(process.env, {
      APP_ENV: 'test',
      API_TOKEN: TOKEN,
      WHATSAPP_SESSION_PATH: join(root, 'sessions'),
      DOWNLOAD_PATH: join(root, 'downloads'),
      LOG_PATH: join(root, 'logs'),
      WHATSAPP_AUTO_CONNECT: 'false',
      WHATSAPP_ALLOWED_GROUPS: '120363000000000001@g.us',
    });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    setupApp(app);
    await app.init();
  });

  afterAll(async () => app?.close());

  it('GET /api/health é público', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', whatsapp: { status: 'DISCONNECTED' } });
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('endpoints administrativos exigem token', async () => {
    await request(app.getHttpServer()).get('/api/whatsapp/status').expect(401);
    await request(app.getHttpServer()).get('/api/whatsapp/status').set('Authorization', 'Bearer errado').expect(401);
    await request(app.getHttpServer()).get('/api/whatsapp/status').set(auth).expect(200);
    await request(app.getHttpServer()).get('/api/whatsapp/status').set('x-api-token', TOKEN).expect(200);
  });

  it('fluxo de conexão: connect → QR → conectado → status/perfil → disconnect', async () => {
    await request(app.getHttpServer()).get('/api/whatsapp/qr').set(auth).expect(404);
    const c = await request(app.getHttpServer()).post('/api/whatsapp/connect').set(auth).expect(200);
    expect(c.body.status).toBe('CONNECTING');
    const sock = sockets.at(-1)!;
    sock.emitUpdate({ qr: '2@qr-de-teste' });
    let qr: any;
    for (let i = 0; i < 100 && !qr; i++) {
      const r = await request(app.getHttpServer()).get('/api/whatsapp/qr').set(auth);
      if (r.status === 200) qr = r.body;
      else await new Promise((res) => setTimeout(res, 30));
    }
    expect(qr.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(qr.base64.length).toBeGreaterThan(100);

    sock.user = { id: '5511999999999:9@s.whatsapp.net', name: 'ChupaLink' };
    sock.emitUpdate({ connection: 'open' });
    const s = await request(app.getHttpServer()).get('/api/whatsapp/status').set(auth).expect(200);
    expect(s.body).toMatchObject({ status: 'CONNECTED', user: { id: '5511999999999:9@s.whatsapp.net' } });
    const p = await request(app.getHttpServer()).get('/api/whatsapp/profile').set(auth).expect(200);
    expect(p.body).toMatchObject({ id: '5511999999999:9@s.whatsapp.net', name: 'ChupaLink' });

    const d = await request(app.getHttpServer()).post('/api/whatsapp/disconnect').set(auth).expect(200);
    expect(d.body.status).toBe('DISCONNECTED');
    expect(existsSync(join(root, 'sessions', 'chupalink'))).toBe(true);
  });

  it('logout exige confirmação', async () => {
    await request(app.getHttpServer()).post('/api/whatsapp/logout').set(auth).send({}).expect(400);
    await request(app.getHttpServer()).post('/api/whatsapp/logout').set(auth).send({ confirm: 'sim' }).expect(400);
  });

  it('sessões: lista e detalha', async () => {
    const list = await request(app.getHttpServer()).get('/api/sessions').set(auth).expect(200);
    expect(list.body.map((s: any) => s.name)).toContain('chupalink');
    const one = await request(app.getHttpServer()).get('/api/sessions/chupalink').set(auth).expect(200);
    expect(one.body).toMatchObject({ name: 'chupalink', exists: true });
    await request(app.getHttpServer()).get('/api/sessions/..%2F..%2Fetc').set(auth).expect(404);
  });

  it('grupos autorizados: env + API, persistidos em disco', async () => {
    const add = await request(app.getHttpServer())
      .post('/api/groups/allowed').set(auth).send({ groupId: '120363000000000002@g.us' }).expect(201);
    expect(add.body.map((g: any) => g.id)).toEqual(['120363000000000001@g.us', '120363000000000002@g.us']);
    const file = JSON.parse(readFileSync(join(root, 'sessions', 'chupalink.groups.json'), 'utf8'));
    expect(file.allowed).toEqual(['120363000000000002@g.us']);
    await request(app.getHttpServer()).post('/api/groups/allowed').set(auth).send({ groupId: 'invalido' }).expect(400);
    await request(app.getHttpServer()).delete('/api/groups/allowed/120363000000000001@g.us').set(auth).expect(400);
    await request(app.getHttpServer()).delete('/api/groups/allowed/120363000000000002@g.us').set(auth).expect(200);
  });

  it('jobs: valida entrada e lista', async () => {
    await request(app.getHttpServer()).post('/api/jobs').set(auth)
      .send({ url: 'https://www.tiktok.com/@a/video/1', groupId: '999999999999@g.us' }).expect(403);
    await request(app.getHttpServer()).post('/api/jobs').set(auth)
      .send({ url: 'https://youtube.com/watch?v=1', groupId: '120363000000000001@g.us' }).expect(400);
    await request(app.getHttpServer()).post('/api/jobs').set(auth).send({ url: 'nada', groupId: 'x', extra: 1 }).expect(400);
    const list = await request(app.getHttpServer()).get('/api/jobs').set(auth).expect(200);
    expect(list.body).toHaveProperty('stats.concurrency', 1);
    await request(app.getHttpServer()).get('/api/jobs/nao-uuid').set(auth).expect(400);
    await request(app.getHttpServer()).get('/api/jobs/6f1c8a52-1d7e-4b8e-9a51-2f7d2c1f0e11').set(auth).expect(404);
  });

  it('downloader: bloqueia SSRF e plataforma não suportada', async () => {
    const a = await request(app.getHttpServer()).post('/api/downloader/inspect').set(auth).send({ url: 'http://127.0.0.1/x.mp4' });
    expect(a.status).toBe(400);
    expect(a.body.code).toBe('BLOCKED_URL');
    const b = await request(app.getHttpServer()).post('/api/downloader/inspect').set(auth).send({ url: 'https://example.com/pagina' });
    expect(b.status).toBe(422);
    const p = await request(app.getHttpServer()).get('/api/downloader/platforms').set(auth).expect(200);
    expect(p.body).toEqual(expect.arrayContaining(['instagram', 'tiktok']));
  });

  it('não expõe a pasta storage por HTTP', async () => {
    await request(app.getHttpServer()).get('/storage/sessions/chupalink/creds.json').expect(404);
    await request(app.getHttpServer()).get('/../storage/sessions/chupalink.groups.json').expect(404);
  });
});
