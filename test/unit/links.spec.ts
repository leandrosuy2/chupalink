import { dedupeKey, extractLinks, hostMatches, normalizeUrl } from '../../src/common/utils/links';

describe('extractLinks', () => {
  it('encontra um link simples', () => {
    expect(extractLinks('olha isso https://www.tiktok.com/@a/video/123')).toEqual(['https://www.tiktok.com/@a/video/123']);
  });

  it('encontra múltiplos links e remove duplicatas', () => {
    const text = 'https://vm.tiktok.com/ZMabc123/ e https://www.instagram.com/reel/Chunk8-jurw/ e de novo https://vm.tiktok.com/ZMabc123/';
    expect(extractLinks(text)).toEqual(['https://vm.tiktok.com/ZMabc123/', 'https://www.instagram.com/reel/Chunk8-jurw/']);
  });

  it('remove pontuação final e fragmentos', () => {
    expect(extractLinks('vejam: https://instagram.com/p/abc/!!')).toEqual(['https://instagram.com/p/abc/']);
    expect(extractLinks('(https://instagram.com/p/abc/)')).toEqual(['https://instagram.com/p/abc/']);
    expect(extractLinks('https://instagram.com/p/abc/#topo.')).toEqual(['https://instagram.com/p/abc/']);
  });

  it('ignora texto sem links e esquemas não http', () => {
    expect(extractLinks('bom dia grupo')).toEqual([]);
    expect(extractLinks(undefined)).toEqual([]);
    expect(extractLinks('ftp://x.com/a javascript:alert(1)')).toEqual([]);
  });

  it('respeita o limite máximo', () => {
    const text = Array.from({ length: 20 }, (_, i) => `https://instagram.com/p/a${i}/`).join(' ');
    expect(extractLinks(text, 5)).toHaveLength(5);
  });
});

describe('normalizeUrl', () => {
  it('rejeita credenciais embutidas e URLs inválidas', () => {
    expect(normalizeUrl('https://user:pass@instagram.com/p/x')).toBeNull();
    expect(normalizeUrl('nao é url')).toBeNull();
    expect(normalizeUrl('file:///etc/passwd')).toBeNull();
  });
  it('normaliza host para minúsculas', () => {
    expect(normalizeUrl('https://WWW.TikTok.com/@a/video/1')).toBe('https://www.tiktok.com/@a/video/1');
  });
});

describe('hostMatches / dedupeKey', () => {
  it('aceita subdomínios mas não domínios parecidos', () => {
    expect(hostMatches('vm.tiktok.com', ['tiktok.com'])).toBe(true);
    expect(hostMatches('tiktok.com.evil.io', ['tiktok.com'])).toBe(false);
    expect(hostMatches('eviltiktok.com', ['tiktok.com'])).toBe(false);
  });
  it('gera a mesma chave ignorando www, barra final e query', () => {
    expect(dedupeKey('https://www.instagram.com/reel/ABC/?igsh=1')).toBe(dedupeKey('https://instagram.com/reel/ABC'));
  });
});
