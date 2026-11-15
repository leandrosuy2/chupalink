import { ChupaError } from '../../src/common/utils/errors';
import { JobsService } from '../../src/modules/jobs/jobs.service';
import { JobStatus } from '../../src/modules/jobs/jobs.types';
import { extractText, MessagesService } from '../../src/modules/messages/messages.service';
import { MessagesProcessor } from '../../src/modules/messages/messages.processor';
import { WhatsappEvents } from '../../src/modules/whatsapp/whatsapp.events';
import { testConfig, waitFor } from '../helpers';

const GROUP = '120363000000000001@g.us';

function waMsg(text: string, opts: { jid?: string; fromMe?: boolean; id?: string; ts?: number } = {}) {
  return {
    key: { remoteJid: opts.jid ?? GROUP, id: opts.id ?? `id-${Math.random()}`, fromMe: !!opts.fromMe, participant: '123@lid', participantAlt: '5511988887777@s.whatsapp.net' },
    pushName: 'Fulano',
    messageTimestamp: opts.ts ?? Math.floor(Date.now() / 1000),
    message: { extendedTextMessage: { text } },
  } as any;
}

function setup(env: Record<string, string> = {}, downloadImpl?: (req: any) => Promise<any>) {
  const config = testConfig(env);
  const jobs = new JobsService(config);
  jobs.retryDelayMs = 1;
  const whatsapp = {
    sendText: jest.fn(async (_jid: string, _text: string, _q?: any) => ({ key: { id: `status-${Math.random()}` } })),
    editText: jest.fn(async (_jid: string, _key: any, _text: string) => ({})),
    sendVideo: jest.fn(async () => ({})),
    wasSentByBot: jest.fn((id: string) => id.startsWith('bot-')),
  };
  const downloader = {
    isSupported: (u: string) => /tiktok\.com|instagram\.com/.test(u),
    platformOf: (u: string) => (u.includes('tiktok') ? 'tiktok' : u.includes('instagram') ? 'instagram' : undefined),
    platforms: () => ['instagram', 'tiktok'],
    cleanup: jest.fn(async () => undefined),
    download: jest.fn(
      downloadImpl ??
        (async (req: any) => {
          await req.onStage?.('downloading');
          return {
            info: { platform: 'tiktok', id: '1', url: req.url, title: 'Teste', uploader: 'tiktok', itemCount: 1 },
            files: [{ path: '/tmp/x.mp4', fileName: 'Teste.mp4', mimetype: 'video/mp4', sizeBytes: 5_000_000, durationSec: 10, transcoded: false }],
          };
        }),
    ),
  };
  const groups = { isAllowed: (j: string) => j === GROUP, getName: async () => 'ChupaLink' };
  const gateway = { broadcast: jest.fn() };
  const events = new WhatsappEvents();
  const processor = new MessagesProcessor(config, events, new MessagesService(), groups as any, jobs, downloader as any, whatsapp as any, gateway as any);
  processor.onModuleInit();
  return { processor, jobs, whatsapp, downloader, events };
}

describe('extractText', () => {
  it('lê texto de mensagens comuns, legendas e envelopes', () => {
    expect(extractText({ conversation: 'oi' })).toBe('oi');
    expect(extractText({ ephemeralMessage: { message: { extendedTextMessage: { text: 'temp' } } } })).toBe('temp');
    expect(extractText({ videoMessage: { caption: 'legenda' } })).toBe('legenda');
    expect(extractText({ viewOnceMessageV2: { message: { imageMessage: { caption: 'vo' } } } })).toBe('vo');
  });
});

describe('MessagesProcessor', () => {
  it('fluxo completo: link no grupo → download → envio do vídeo respondendo a mensagem', async () => {
    const { processor, jobs, whatsapp, downloader } = setup();
    const msg = waMsg('olha https://www.tiktok.com/@tiktok/video/7708408003065580831 kkk');
    await processor.handleMessage(msg);
    const [job] = jobs.list();
    expect(job).toMatchObject({ platform: 'tiktok', chatJid: GROUP, sender: '5511988887777@s.whatsapp.net', senderName: 'Fulano' });
    await waitFor(() => jobs.get(job.id).status === JobStatus.COMPLETED);

    // uma única mensagem de status, respondendo ao link, depois só edições
    expect(whatsapp.sendText).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendText.mock.calls[0][1]).toContain('*CHUPALINK*');
    expect(whatsapp.sendText.mock.calls[0][2]).toBe(msg);
    const edits = whatsapp.editText.mock.calls.map((c: any[]) => c[2] as string);
    expect(edits.some((t) => t.includes('🔄'))).toBe(true);
    expect(edits.at(-1)).toMatch(/Tudo em \*\d+,\ds\*/);
    expect(edits.at(-1)).not.toContain('🔄');
    expect(whatsapp.sendVideo).toHaveBeenCalledTimes(1);
    const [jid, path, opts] = whatsapp.sendVideo.mock.calls[0] as any[];
    expect(jid).toBe(GROUP);
    expect(path).toBe('/tmp/x.mp4');
    expect(opts).toMatchObject({ fileName: 'Teste.mp4', asDocument: false, mimetype: 'video/mp4', quoted: msg });
    expect(opts.caption).toContain('🎵 *TikTok* · @tiktok');
    expect(opts.caption).toContain('⏱️ 0:10');
    expect(opts.caption).toContain('🤖 *ChupaLink* — mandou o link, recebeu o vídeo!');
    expect(downloader.cleanup).toHaveBeenCalledWith(job.id);
    expect(jobs.get(job.id).result?.files[0]).toMatchObject({ sentAs: 'video' });
  });

  it('cria uma tarefa por link suportado em mensagens com vários links', async () => {
    const { processor, jobs } = setup();
    await processor.handleMessage(
      waMsg('https://www.instagram.com/reel/Chunk8-jurw/ https://g1.globo.com/noticia https://vm.tiktok.com/ZMabc123/'),
    );
    expect(jobs.list().map((j) => j.platform).sort()).toEqual(['instagram', 'tiktok']);
  });

  it('ignora mensagens do próprio bot, privadas, de grupos não autorizados, antigas e repetidas', async () => {
    const { processor, jobs } = setup();
    const link = 'https://www.tiktok.com/@a/video/1';
    await processor.handleMessage(waMsg(link, { fromMe: true, id: 'bot-123' }));
    await processor.handleMessage(waMsg(link, { jid: '5511999999999@s.whatsapp.net' }));
    await processor.handleMessage(waMsg(link, { jid: '999999999999@g.us' }));
    await processor.handleMessage(waMsg(link, { ts: Math.floor(Date.now() / 1000) - 3600 }));
    expect(jobs.list()).toHaveLength(0);
    const m = waMsg(link, { id: 'repetida' });
    await processor.handleMessage(m);
    await processor.handleMessage(m);
    expect(jobs.list()).toHaveLength(1);
  });

  it('processa links enviados do celular do próprio número do bot', async () => {
    const { processor, jobs } = setup();
    await processor.handleMessage(waMsg('https://www.tiktok.com/@a/video/42', { fromMe: true, id: 'celular-1' }));
    expect(jobs.list()).toHaveLength(1);
  });

  it('com BOT_PROGRESS_MESSAGES=false só manda o vídeo (e erros como mensagem simples)', async () => {
    const ok = setup({ BOT_PROGRESS_MESSAGES: 'false' });
    await ok.processor.handleMessage(waMsg('https://www.tiktok.com/@a/video/91'));
    await waitFor(() => ok.jobs.list()[0].status === JobStatus.COMPLETED);
    expect(ok.whatsapp.sendText).not.toHaveBeenCalled();
    expect(ok.whatsapp.sendVideo).toHaveBeenCalledTimes(1);

    const bad = setup({ BOT_PROGRESS_MESSAGES: 'false' }, async () => {
      throw new ChupaError('NO_VIDEO', 'sem vídeo');
    });
    const m = waMsg('https://www.instagram.com/p/xyz987/');
    await bad.processor.handleMessage(m);
    await waitFor(() => bad.whatsapp.sendText.mock.calls.length === 1);
    expect(bad.whatsapp.sendText.mock.calls[0][1]).toContain('não tem vídeo');
    expect(bad.whatsapp.sendText.mock.calls[0][2]).toBe(m); // responde ao link original
  });

  it('não responde a links de plataformas não suportadas', async () => {
    const { processor, jobs, whatsapp } = setup();
    await processor.handleMessage(waMsg('https://youtube.com/watch?v=1'));
    expect(jobs.list()).toHaveLength(0);
    expect(whatsapp.sendText).not.toHaveBeenCalled();
  });

  it('avisa o grupo quando o vídeo é privado (sem tentar de novo)', async () => {
    const { processor, jobs, whatsapp, downloader } = setup({}, async () => {
      throw new ChupaError('PRIVATE', 'privado');
    });
    await processor.handleMessage(waMsg('https://www.instagram.com/p/abc123/'));
    const [job] = jobs.list();
    await waitFor(() => jobs.get(job.id).status === JobStatus.FAILED);
    await waitFor(() => whatsapp.editText.mock.calls.some((c: any[]) => c[2].includes('privado')));
    const last = whatsapp.editText.mock.calls.at(-1)![2] as string;
    expect(last).toContain('❌');
    expect(whatsapp.sendText).toHaveBeenCalledTimes(1); // o erro edita o status, não manda outra mensagem
    expect(downloader.download).toHaveBeenCalledTimes(1);
  });

  it('envia como documento acima do limite de vídeo e recusa acima do limite de documento', async () => {
    const big = (size: number) => async (req: any) => ({
      info: { platform: 'instagram', id: '1', url: req.url, itemCount: 1 },
      files: [{ path: '/tmp/big.mp4', fileName: 'big.mp4', mimetype: 'video/mp4', sizeBytes: size, durationSec: 60, transcoded: false }],
    });
    const MB = 1024 * 1024;
    const a = setup({ WHATSAPP_VIDEO_MAX_MB: '10', WHATSAPP_DOCUMENT_MAX_MB: '50' }, big(20 * MB));
    await a.processor.handleMessage(waMsg('https://www.instagram.com/reel/AAA111/'));
    await waitFor(() => a.jobs.list()[0].status === JobStatus.COMPLETED);
    expect((a.whatsapp.sendVideo.mock.calls[0] as any[])[2]).toMatchObject({ asDocument: true });

    const b = setup({ WHATSAPP_VIDEO_MAX_MB: '10', WHATSAPP_DOCUMENT_MAX_MB: '50' }, big(80 * MB));
    await b.processor.handleMessage(waMsg('https://www.instagram.com/reel/BBB222/'));
    await waitFor(() => b.jobs.list()[0].status === JobStatus.FAILED);
    expect(b.whatsapp.sendVideo).not.toHaveBeenCalled();
    await waitFor(() => b.whatsapp.editText.mock.calls.some((c: any[]) => c[2].includes('grande demais')));
  });

  it('falha de envio: tenta 2 vezes e não refaz o download', async () => {
    const { processor, jobs, whatsapp, downloader } = setup({ DOWNLOAD_MAX_ATTEMPTS: '3' });
    whatsapp.sendVideo.mockRejectedValue(new ChupaError('SEND_FAILED', 'upload falhou', true));
    await processor.handleMessage(waMsg('https://www.tiktok.com/@a/video/55'));
    await waitFor(() => jobs.list()[0].status === JobStatus.FAILED, 10_000);
    expect(whatsapp.sendVideo).toHaveBeenCalledTimes(2);
    expect(downloader.download).toHaveBeenCalledTimes(1);
  });

  it('não reenvia o mesmo vídeo pedido de novo logo em seguida', async () => {
    const { processor, jobs, whatsapp } = setup();
    await processor.handleMessage(waMsg('https://www.tiktok.com/@a/video/77'));
    await waitFor(() => jobs.list()[0].status === JobStatus.COMPLETED);
    await processor.handleMessage(waMsg('https://tiktok.com/@a/video/77/?lang=pt'));
    expect(jobs.list()).toHaveLength(1);
    expect((whatsapp.sendText.mock.calls.at(-1) as any[])[1]).toContain('☝️');
  });
});
