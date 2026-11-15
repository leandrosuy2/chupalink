/**
 * Teste REAL de ponta a ponta (rede + yt-dlp + ffmpeg): uma mensagem com link chega ao grupo,
 * o vídeo é baixado do TikTok/Instagram, verificado e "enviado" pelo socket.
 * O socket do WhatsApp é simulado (não há celular pareado no CI), todo o resto é real.
 * Executar com: npm run test:network
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execFileSync } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { sockets } from '../mocks/baileys.mock';
import { AppModule } from '../../src/app.module';
import { JobsService } from '../../src/modules/jobs/jobs.service';
import { JobStatus } from '../../src/modules/jobs/jobs.types';
import { WhatsappConnection } from '../../src/modules/whatsapp/whatsapp.connection';
import { tempDir, waitFor } from '../helpers';

const GROUP = '120363000000000001@g.us';
const run = process.env.RUN_NETWORK_TESTS === '1' ? describe : describe.skip;

interface Probe { codec: string; audio?: string; size: number; duration: number; format: string }
function probe(file: string): Probe {
  const out = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '--', file]).toString());
  return {
    codec: out.streams.find((s: any) => s.codec_type === 'video')?.codec_name,
    audio: out.streams.find((s: any) => s.codec_type === 'audio')?.codec_name,
    size: statSync(file).size,
    duration: Number(out.format.duration),
    format: out.format.format_name,
  };
}

run('Download real Instagram/TikTok → envio no grupo', () => {
  let app: INestApplication;
  let jobs: JobsService;
  let root: string;
  const sentVideos: Array<{ caption: string; fileName: string; probe: Probe; asDocument: boolean; quoted: boolean }> = [];

  beforeAll(async () => {
    root = tempDir();
    Object.assign(process.env, {
      APP_ENV: 'test',
      API_TOKEN: 'token-de-teste-network-123456',
      WHATSAPP_SESSION_PATH: join(root, 'sessions'),
      DOWNLOAD_PATH: join(root, 'downloads'),
      LOG_PATH: join(root, 'logs'),
      WHATSAPP_AUTO_CONNECT: 'false',
      WHATSAPP_ALLOWED_GROUPS: GROUP,
      DOWNLOAD_MAX_SIZE_MB: '200',
      YTDLP_PATH: process.env.YTDLP_PATH ?? 'yt-dlp',
    });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    jobs = app.get(JobsService);

    await app.get(WhatsappConnection).start();
    const sock = sockets.at(-1)!;
    sock.sendMessage.mockImplementation(async (jid: string, content: any, options: any) => {
      const media = content.video ?? content.document;
      if (media) {
        // o arquivo precisa existir no disco no momento do envio (streaming, não buffer)
        expect(typeof media.url).toBe('string');
        sentVideos.push({ caption: content.caption, fileName: content.fileName, probe: probe(media.url), asDocument: !!content.document, quoted: !!options?.quoted });
      }
      return { key: { id: `s${Math.random()}`, remoteJid: jid, fromMe: true }, message: { conversation: '' } };
    });
    sock.user = { id: '5511999999999:9@s.whatsapp.net' };
    sock.emitUpdate({ connection: 'open' });
  });

  afterAll(async () => app?.close());

  const deliver = (text: string) => {
    sockets.at(-1)!.ev.emit('messages.upsert', {
      type: 'notify',
      messages: [{
        key: { remoteJid: GROUP, id: `m${Math.random()}`, fromMe: false, participant: '5511988887777@s.whatsapp.net' },
        pushName: 'Tester',
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: { conversation: text },
      }],
    });
  };

  async function processLink(text: string) {
    const before = sentVideos.length;
    const nJobs = jobs.list().length;
    deliver(text);
    await waitFor(() => jobs.list().length > nJobs, 10_000);
    const job = jobs.list()[0];
    await waitFor(() => [JobStatus.COMPLETED, JobStatus.FAILED].includes(jobs.get(job.id).status), 240_000);
    return { job: jobs.get(job.id), videos: sentVideos.slice(before) };
  }

  it('TikTok: baixa sem marca d\'água em H.264 e envia como vídeo', async () => {
    const { job, videos } = await processLink('vejam https://www.tiktok.com/@tiktok/video/7708408003065580831');
    expect(job.error).toBeUndefined();
    expect(job.status).toBe(JobStatus.COMPLETED);
    expect(videos).toHaveLength(1);
    expect(videos[0].probe).toMatchObject({ codec: 'h264', audio: 'aac' });
    expect(videos[0].probe.duration).toBeGreaterThan(70);
    expect(videos[0].asDocument).toBe(false);
    expect(videos[0].quoted).toBe(true);
    expect(videos[0].caption).toContain('*TikTok* · @tiktok');
    expect(videos[0].fileName).toMatch(/\.mp4$/);
    // a mensagem de status passou pela etapa de download e terminou como concluída
    // (a barra ▰▱ só aparece se o download durar mais que o intervalo entre edições)
    const edits = sockets.at(-1)!.sendMessage.mock.calls.map((c: any[]) => c[1]).filter((c: any) => c.edit).map((c: any) => c.text as string);
    expect(edits.some((t) => t.includes('🔄'))).toBe(true);
    expect(edits.at(-1)).toMatch(/✅ .*\(9,\d MB\)/);
    expect(edits.at(-1)).toContain('Tudo em');
    // eslint-disable-next-line no-console
    if (process.env.SHOW_STATUS) console.log(edits.join('\n\n-----\n\n'));
  }, 300_000);

  it('Instagram Reel: baixa e envia', async () => {
    const { job, videos } = await processLink('https://www.instagram.com/reel/Chunk8-jurw/?igsh=abc');
    expect(job.error).toBeUndefined();
    expect(videos).toHaveLength(1);
    expect(videos[0].probe.codec).toBe('h264');
    expect(videos[0].probe.format).toMatch(/mp4/);
    expect(videos[0].caption).toContain('Instagram');
  }, 300_000);

  it('Instagram carrossel (/p/): envia os vídeos do post', async () => {
    const { job, videos } = await processLink('https://www.instagram.com/p/BQ0eAlwhDrw/');
    expect(job.status).toBe(JobStatus.COMPLETED);
    expect(videos.length).toBeGreaterThanOrEqual(1);
    videos.forEach((v) => expect(v.probe.codec).toBe('h264'));
    expect(job.result?.files.length).toBe(videos.length);
  }, 300_000);

  it('remove os arquivos temporários após o envio', () => {
    const dl = join(root, 'downloads');
    expect(existsSync(dl)).toBe(true);
    expect(readdirSync(dl).filter((d) => d.startsWith('job-'))).toEqual([]);
  });

  it('link inexistente: falha com mensagem amigável no grupo', async () => {
    const sock = sockets.at(-1)!;
    const textsBefore = sock.sendMessage.mock.calls.length;
    const { job } = await processLink('https://www.tiktok.com/@tiktok/video/1111111111111111111');
    expect(job.status).toBe(JobStatus.FAILED);
    const texts = sock.sendMessage.mock.calls.slice(textsBefore).map((c: any[]) => c[1].text).filter(Boolean);
    expect(texts.at(-1)).toMatch(/não está disponível/);
  }, 300_000);
});
