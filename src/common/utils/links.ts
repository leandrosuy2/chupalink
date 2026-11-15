/**
 * Extrai links http(s) de um texto livre (mensagem do WhatsApp).
 * Remove pontuação final comum, deduplica e preserva a ordem.
 */
const URL_REGEX = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const TRAILING = /[)\]}.,;:!?…*_~]+$/;

export function extractLinks(text: string | null | undefined, max = 10): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const raw of text.match(URL_REGEX) ?? []) {
    let candidate = raw;
    // remove pontuação final, mas mantém parênteses balanceados
    while (TRAILING.test(candidate)) {
      const opens = (candidate.match(/\(/g) ?? []).length;
      const closes = (candidate.match(/\)/g) ?? []).length;
      if (candidate.endsWith(')') && opens >= closes) break;
      candidate = candidate.replace(/.$/, '');
    }
    const normalized = normalizeUrl(candidate);
    if (normalized) found.add(normalized);
    if (found.size >= max) break;
  }
  return [...found];
}

/** Valida e normaliza uma URL. Retorna null se for inválida ou não for http(s). */
export function normalizeUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (!url.hostname || url.hostname.length > 253) return null;
  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  return url.toString();
}

export function hostMatches(hostname: string, domains: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Chave estável para deduplicação: host sem "www." + caminho sem barra final, sem query de rastreio. */
export function dedupeKey(url: string): string {
  const u = new URL(url);
  const host = u.hostname.replace(/^(www|m)\./, '');
  const path = u.pathname.replace(/\/+$/, '');
  return `${host}${path}`;
}
