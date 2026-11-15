import { sanitizeFileName } from '../../src/common/utils/files';

describe('sanitizeFileName', () => {
  it('remove path traversal e caracteres especiais', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('etc_passwd');
    expect(sanitizeFileName('Vídeo 🎾 "incrível" <teste>')).toBe('Video_incrivel_teste');
  });
  it('usa fallback para nomes vazios', () => {
    expect(sanitizeFileName('🎾🎾', 'video')).toBe('video');
    expect(sanitizeFileName(undefined, 'x')).toBe('x');
  });
  it('limita o tamanho', () => {
    expect(sanitizeFileName('a'.repeat(300), 'v', 50).length).toBeLessThanOrEqual(50);
  });
});
