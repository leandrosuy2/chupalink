import { DownloaderFactory } from '../../src/modules/downloader/downloader.factory';
import { DirectProvider } from '../../src/modules/downloader/providers/direct.provider';
import { InstagramProvider } from '../../src/modules/downloader/providers/instagram.provider';
import { TiktokProvider } from '../../src/modules/downloader/providers/tiktok.provider';
import { mapYtdlpError } from '../../src/modules/downloader/providers/ytdlp.provider';
import { testConfig } from '../helpers';

describe('DownloaderFactory', () => {
  const config = testConfig();
  const factory = new DownloaderFactory([new DirectProvider(config), new InstagramProvider(config), new TiktokProvider(config)]);

  it.each([
    ['https://www.instagram.com/reel/Chunk8-jurw/', 'instagram'],
    ['https://www.instagram.com/reels/Chunk8-jurw/', 'instagram'],
    ['https://instagram.com/p/BQ0eAlwhDrw/?igsh=abc', 'instagram'],
    ['https://www.instagram.com/tv/BkfuX9UB-eK/', 'instagram'],
    ['https://www.instagram.com/instagram/reel/Chunk8-jurw/', 'instagram'],
    ['https://www.instagram.com/share/reel/BAabc123', 'instagram'],
    ['https://www.tiktok.com/@tiktok/video/7708408003065580831', 'tiktok'],
    ['https://m.tiktok.com/@user.name/video/123456', 'tiktok'],
    ['https://vm.tiktok.com/ZMhvqKx2a/', 'tiktok'],
    ['https://vt.tiktok.com/ZSabc123/', 'tiktok'],
    ['https://www.tiktok.com/t/ZTRabc123/', 'tiktok'],
    ['https://cdn.exemplo.com/videos/clip.mp4', 'direct'],
  ])('%s → %s', (url, platform) => {
    expect(factory.resolve(url).platform).toBe(platform);
  });

  it.each([
    'https://www.instagram.com/instagram/', // perfil, não post
    'https://www.tiktok.com/@tiktok', // perfil
    'https://www.youtube.com/watch?v=abc',
    'https://instagram.com.evil.io/reel/abc/',
    'https://exemplo.com/pagina',
  ])('não suporta %s', (url) => {
    expect(factory.find(url)).toBeUndefined();
    expect(() => factory.resolve(url)).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_PLATFORM' }));
  });

  it('rejeita URL inválida', () => {
    expect(() => factory.resolve('isso não é link')).toThrow(expect.objectContaining({ code: 'INVALID_URL' }));
  });
});

describe('mapYtdlpError', () => {
  it.each([
    ['ERROR: [Instagram] abc: Requested content is not available, rate-limit reached or login required. Use --cookies', 'LOGIN_REQUIRED', false],
    ['ERROR: [Instagram] abc: There is no video in this post', 'NO_VIDEO', false],
    ['ERROR: [TikTok] 123: This video is private', 'PRIVATE', false],
    ['ERROR: [TikTok] 123: Video not available, status code 10204', 'UNAVAILABLE', false],
    ['ERROR: unable to download: HTTP Error 429: Too Many Requests', 'RATE_LIMITED', true],
    ['ERROR: Read timed out', 'INTERRUPTED', true],
    ['File is larger than max-filesize (1000 bytes > 10 bytes). Aborting.', 'TOO_LARGE', false],
    ['ERROR: [TikTok] 111: Your IP address is blocked from accessing this post', 'UNAVAILABLE', false],
    ['ERROR: [Instagram] X: Instagram sent an empty media response. Check if this post is accessible in your browser without being logged-in. If it is not, then use --cookies', 'LOGIN_REQUIRED', false],
    ['ERROR: algo estranho', 'UNKNOWN', true],
  ])('%s → %s', (stderr, code, retryable) => {
    const err = mapYtdlpError(stderr, 'x');
    expect(err.code).toBe(code);
    expect(err.retryable).toBe(retryable);
  });
});
