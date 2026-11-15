import { cleanTitle, formatDuration, progressBar, qualityLabel, renderCaption, renderStatus } from '../../src/modules/messages/bot-messages';
import { StatusMessage } from '../../src/modules/messages/status-message';
import { createYtdlpProgressParser } from '../../src/modules/downloader/providers/ytdlp.provider';

const first = (_k: string, l: readonly string[]) => l[0];

describe('bot-messages', () => {
  it('barra de progresso', () => {
    expect(progressBar(0)).toBe('▱▱▱▱▱▱▱▱▱▱');
    expect(progressBar(52)).toBe('▰▰▰▰▰▱▱▱▱▱');
    expect(progressBar(100)).toBe('▰▰▰▰▰▰▰▰▰▰');
    expect(progressBar(250)).toBe('▰▰▰▰▰▰▰▰▰▰');
  });

  it('duração, qualidade e título', () => {
    expect(formatDuration(79)).toBe('1:19');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(undefined)).toBeUndefined();
    expect(qualityLabel(720, 1280)).toBe('720p');
    expect(qualityLabel(2160, 3840)).toBe('4K');
    expect(cleanTitle('Olha isso #fyp #viral   demais')).toBe('Olha isso demais');
    expect(cleanTitle('Video by naomipq')).toBeUndefined();
    expect(cleanTitle('a'.repeat(200))!.length).toBeLessThanOrEqual(90);
  });

  it('status: checklist com etapa atual, concluídas no passado e progresso', () => {
    const t = renderStatus(
      { phase: 'downloading', platform: 'tiktok', uploader: 'tiktok', progress: { percent: 52, downloadedBytes: 5e6, totalBytes: 1e7, item: 1, items: 1 } },
      first,
    );
    expect(t).toContain('🤖 *CHUPALINK*');
    expect(t).toContain('🎵 *TikTok* · @tiktok');
    expect(t).toContain('✅ Link farejado');
    expect(t).toContain('🔄 *Puxando o vídeo...*');
    expect(t).toContain('▰▰▰▰▰▱▱▱▱▱ *52%*');
    expect(t).toContain('▫️ Enviando pro grupo');
  });

  it('status de carrossel mostra o vídeo atual', () => {
    const t = renderStatus({ phase: 'downloading', platform: 'instagram', progress: { percent: 10, downloadedBytes: 1, totalBytes: 10, item: 2, items: 3 } }, first);
    expect(t).toContain('🎞️ Vídeo 2 de 3');
  });

  it('status de falha marca a etapa com ❌ e mostra o motivo', () => {
    const t = renderStatus({ phase: 'failed', failedAt: 'downloading', platform: 'instagram', errorText: '🔒 privado' }, first);
    expect(t).toContain('✅ Link farejado');
    expect(t).toContain('❌ Puxando o vídeo');
    expect(t).toContain('🔒 privado');
  });

  it('status na fila', () => {
    expect(renderStatus({ phase: 'queued', platform: 'tiktok', queuePosition: 3 }, first)).toContain('Posição na fila: *3*');
  });

  it('legenda com dados do vídeo', () => {
    const c = renderCaption(
      { platform: 'instagram', uploader: 'instagram', title: 'Reel legal #reels', durationSec: 15, width: 1080, height: 1920, sizeBytes: 3 * 1048576, index: 1, total: 3, asDocument: true },
      () => 0,
    );
    expect(c).toContain('_(2/3)_');
    expect(c).toContain('📸 *Instagram* · @instagram');
    expect(c).toContain('📝 _Reel legal_');
    expect(c).toContain('⏱️ 0:15 · 📐 1080p · 💾 3,0 MB');
    expect(c).toContain('📎');
    expect(c).toContain('🤖 *ChupaLink*');
  });
});

describe('StatusMessage', () => {
  it('envia uma vez, depois só edita; agrupa atualizações rápidas de progresso', async () => {
    const sender = {
      sendText: jest.fn(async (_j: string, _t: string) => ({ key: { id: 'k1' } })),
      editText: jest.fn(async (_j: string, _k: any, _t: string) => ({})),
    };
    const s = new StatusMessage(sender, 'g@g.us', undefined, { phase: 'searching', platform: 'tiktok' }, () => 0, 200);
    void s.update({}, true);
    await s.update({ phase: 'downloading' }, true);
    for (let p = 1; p <= 50; p++) void s.update({ progress: { percent: p, downloadedBytes: p, totalBytes: 100, item: 1, items: 1 } });
    await new Promise((r) => setTimeout(r, 350));
    await s.settle();
    expect(sender.sendText).toHaveBeenCalledTimes(1);
    // 1 edição de etapa + no máximo 2 de progresso agrupadas (não 50)
    expect(sender.editText.mock.calls.length).toBeLessThanOrEqual(3);
    expect(sender.editText.mock.calls.at(-1)![2]).toContain('50%');
    expect(sender.editText.mock.calls.every((c: any[]) => c[1].id === 'k1')).toBe(true);
  });

  it('não reenvia texto idêntico e sobrevive a falha de edição', async () => {
    const sender = { sendText: jest.fn(async () => ({ key: { id: 'k' } })), editText: jest.fn(async () => { throw new Error('x'); }) };
    const s = new StatusMessage(sender, 'g@g.us', undefined, { phase: 'searching' }, () => 0, 0);
    await s.update({}, true);
    await s.update({}, true);
    expect(sender.sendText).toHaveBeenCalledTimes(1);
    await expect(s.update({ phase: 'done' }, true)).resolves.toBeUndefined();
  });
});

describe('progresso do yt-dlp', () => {
  it('lê o template e nunca volta para trás no mesmo item', () => {
    const seen: number[] = [];
    const parse = createYtdlpProgressParser(1, (p) => seen.push(Math.round(p.percent ?? -1)));
    parse('CHUPA|NA|500|1000|NA');
    parse('[download] outra linha qualquer');
    parse('CHUPA|NA|900|1000|NA');
    parse('CHUPA|NA|100|400|NA'); // áudio separado reinicia a contagem → ignorado
    parse('CHUPA|NA|1000|1000|NA');
    expect(seen).toEqual([50, 90, 100]);
  });

  it('usa o tamanho estimado e o índice do carrossel', () => {
    const got: any[] = [];
    const parse = createYtdlpProgressParser(3, (p) => got.push(p));
    parse('CHUPA|2|250|NA|1000');
    expect(got[0]).toMatchObject({ item: 2, items: 3, percent: 25, totalBytes: 1000 });
  });
});
