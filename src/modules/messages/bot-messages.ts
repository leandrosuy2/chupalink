/**
 * Personalidade do ChupaLink: frases, barra de progresso e legendas.
 * As frases são sorteadas para o bot não soar repetitivo.
 * Formatação do WhatsApp: *negrito*, _itálico_, ~tachado~, ```mono```.
 */
import { formatBytes } from '../../common/utils/files';

export type Phase = 'queued' | 'searching' | 'downloading' | 'converting' | 'sending' | 'done' | 'failed';

export const PLATFORM_LABEL: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  direct: 'Link direto',
};

const PLATFORM_ICON: Record<string, string> = { instagram: '📸', tiktok: '🎵', direct: '🔗' };

export const PHRASES = {
  header: {
    queued: ['⏳ na fila de espera', '🚦 aguardando a vez', '🧍 entrou na fila'],
    searching: ['⚡ processando...', '🛰️ rastreando...', '🔥 modo turbo ativado', '🦾 trabalhando nisso...'],
    downloading: ['⚡ processando...', '🔥 modo turbo ativado', '🦾 trabalhando nisso...', '🚀 acelerando...'],
    converting: ['🧪 fazendo a mágica...', '⚙️ ajustando os parafusos...'],
    sending: ['📡 transmitindo...', '🛫 decolando...'],
    done: ['✅ missão cumprida!', '🎯 alvo atingido!', '🏁 chegou ao destino!', '🔥 serviço feito!'],
    failed: ['💥 deu ruim...', '🫠 não rolou dessa vez', '🚧 travou no caminho'],
  },
  // "fazendo|feito": o texto muda quando a etapa termina
  searching: ['Farejando o link|Link farejado', 'Rastreando o vídeo|Vídeo rastreado', 'Investigando o link|Link investigado', 'Localizando o vídeo|Vídeo localizado'],
  downloading: ['Puxando o vídeo|Vídeo puxado', 'Sugando o vídeo|Vídeo sugado', 'Baixando o vídeo|Vídeo baixado', 'Trazendo o vídeo pra cá|Vídeo na área'],
  converting: ['Convertendo pro WhatsApp|Convertido pro WhatsApp', 'Ajustando o formato|Formato ajustado', 'Fazendo a conversão|Conversão feita'],
  preparing: ['Deixando no jeito|Tudo no jeito', 'Conferindo o arquivo|Arquivo conferido', 'Polindo o arquivo|Arquivo polido'],
  sending: ['Enviando pro grupo|Entregue no grupo', 'Subindo pro WhatsApp|Subiu pro WhatsApp', 'Despachando pro grupo|Despachado pro grupo'],
  queued: ['Já já é sua vez!', 'Segura que tá quase!', 'Tô terminando outro aqui, já volto!'],
  captionHeadline: [
    '🍿 *Pega a pipoca, chegou o vídeo!*',
    '🎬 *Tá na mão!*',
    '🚀 *Entregue direto do forno!*',
    '😎 *Prontinho, chefe!*',
    '🔥 *Saiu quentinho!*',
    '📦 *Encomenda entregue!*',
    '⚡ *Chegou voando!*',
  ],
  duplicate: [
    '♻️ Esse eu já mandei agorinha! Dá uma olhada aí em cima ☝️',
    '👀 Opa, esse vídeo já tá no grupo! Rola pra cima ☝️',
    '🔁 Déjà vu! Esse acabou de ser enviado ☝️',
  ],
  sloganFooter: ['🤖 *ChupaLink* — mandou o link, recebeu o vídeo!'],
};

export const DIVIDER = '━━━━━━━━━━━━━━━';

export function pick<T>(list: readonly T[], random: () => number = Math.random): T {
  return list[Math.floor(random() * list.length) % list.length];
}

/** ▰▰▰▰▰▱▱▱▱▱ — barra de 10 blocos. */
export function progressBar(percent: number, size = 10): string {
  const p = Math.max(0, Math.min(100, percent));
  const filled = Math.round((p / 100) * size);
  return '▰'.repeat(filled) + '▱'.repeat(size - filled);
}

export function formatDuration(sec?: number): string | undefined {
  if (!sec || !Number.isFinite(sec)) return undefined;
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace('.', ',')}s`;
}

/** Tamanho em pt-BR ("9,5 MB"). */
export function size(bytes: number): string {
  return formatBytes(bytes).replace('.', ',');
}

export function qualityLabel(width?: number, height?: number): string | undefined {
  if (!width || !height) return undefined;
  const p = Math.min(width, height);
  if (p >= 2160) return '4K';
  if (p >= 1440) return '1440p';
  return `${p}p`;
}

/** Remove hashtags/menções em excesso e encurta o título. */
export function cleanTitle(title?: string, max = 90): string | undefined {
  if (!title) return undefined;
  const t = title
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || /^(video|post) by /i.test(t)) return undefined;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function sourceLine(platform?: string, uploader?: string): string | undefined {
  if (!platform) return undefined;
  const icon = PLATFORM_ICON[platform] ?? '📱';
  const label = PLATFORM_LABEL[platform] ?? platform;
  return `${icon} *${label}*${uploader ? ` · @${uploader.replace(/^@/, '')}` : ''}`;
}

// ------------------------------------------------------------------ status

export interface StatusState {
  phase: Phase;
  platform?: string;
  uploader?: string;
  queuePosition?: number;
  progress?: { percent?: number; downloadedBytes: number; totalBytes?: number; item: number; items: number };
  downloadedBytes?: number;
  converted?: boolean;
  sendIndex?: number;
  sendTotal?: number;
  elapsedMs?: number;
  errorText?: string;
  /** Etapa em que a falha aconteceu. */
  failedAt?: Phase;
}

const STEP_ORDER: Phase[] = ['searching', 'downloading', 'converting', 'sending'];

/**
 * Monta a mensagem de status (editada a cada etapa).
 * `choose` devolve uma frase estável por chave, para o texto não "pular" entre edições.
 */
export function renderStatus(s: StatusState, choose: (key: string, list: readonly string[]) => string): string {
  const header = `🤖 *CHUPALINK* ${choose(`h:${s.phase}`, PHRASES.header[s.phase])}`;
  const lines = [header, DIVIDER];
  const src = sourceLine(s.platform, s.uploader);
  if (src) lines.push(src, '');

  if (s.phase === 'queued') {
    lines.push(`⏳ Posição na fila: *${s.queuePosition ?? 1}*`, `_${choose('q', PHRASES.queued)}_`);
    return lines.join('\n');
  }

  const current = s.phase === 'failed' ? (s.failedAt ?? 'searching') : s.phase;
  const idx = (p: Phase) => (p === 'done' ? STEP_ORDER.length : STEP_ORDER.indexOf(p));
  const step = (p: Phase, phrase: string, extra = '') => {
    const [doing, done = doing] = phrase.split('|');
    const i = idx(p);
    const c = idx(current);
    if (s.phase === 'failed' && i === c) return `❌ ${doing}`;
    if (i < c || s.phase === 'done') return `✅ ${done}${extra}`;
    if (i === c) return `🔄 *${doing}...*`;
    return `▫️ ${doing}`;
  };

  lines.push(step('searching', choose('s', PHRASES.searching)));

  const dlDone = s.downloadedBytes ? ` _(${size(s.downloadedBytes)})_` : '';
  lines.push(step('downloading', choose('d', PHRASES.downloading), dlDone));
  if (s.phase === 'downloading' && s.progress) {
    const p = s.progress;
    const item = p.items > 1 ? `🎞️ Vídeo ${p.item} de ${p.items}\n` : '';
    if (p.percent !== undefined) {
      lines.push(`${item}${progressBar(p.percent)} *${Math.floor(p.percent)}%*`);
      if (p.totalBytes) lines.push(`💾 ${size(p.downloadedBytes)} de ${size(p.totalBytes)}`);
    } else if (p.downloadedBytes) {
      lines.push(`${item}💾 ${size(p.downloadedBytes)} baixados...`);
    }
  }

  lines.push(step('converting', choose(s.converted ? 'c' : 'p', s.converted ? PHRASES.converting : PHRASES.preparing)));

  const sendExtra = s.sendTotal && s.sendTotal > 1 && s.phase === 'sending' ? ` (${s.sendIndex}/${s.sendTotal})` : '';
  lines.push(step('sending', choose('e', PHRASES.sending) + sendExtra));

  if (s.phase === 'done' && s.elapsedMs) lines.push('', `⚡ Tudo em *${formatSeconds(s.elapsedMs)}*`);
  if (s.phase === 'failed' && s.errorText) lines.push('', s.errorText);
  return lines.join('\n');
}

// ------------------------------------------------------------------ legenda

export interface CaptionInput {
  platform: string;
  uploader?: string;
  title?: string;
  durationSec?: number;
  width?: number;
  height?: number;
  sizeBytes: number;
  index: number;
  total: number;
  asDocument: boolean;
}

export function renderCaption(c: CaptionInput, random: () => number = Math.random): string {
  const lines = [pick(PHRASES.captionHeadline, random) + (c.total > 1 ? ` _(${c.index + 1}/${c.total})_` : ''), ''];
  const src = sourceLine(c.platform, c.uploader);
  if (src) lines.push(src);
  const title = cleanTitle(c.title);
  if (title) lines.push(`📝 _${title}_`);
  const meta = [
    formatDuration(c.durationSec) && `⏱️ ${formatDuration(c.durationSec)}`,
    qualityLabel(c.width, c.height) && `📐 ${qualityLabel(c.width, c.height)}`,
    `💾 ${size(c.sizeBytes)}`,
  ].filter(Boolean);
  lines.push(meta.join(' · '));
  if (c.asDocument) lines.push('📎 _Mandei como arquivo porque é grandão pro player do WhatsApp._');
  lines.push('', pick(PHRASES.sloganFooter, random));
  return lines.join('\n');
}
