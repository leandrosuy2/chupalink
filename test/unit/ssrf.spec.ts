import { assertPublicHost, isPublicIp } from '../../src/common/utils/ssrf';

describe('SSRF', () => {
  it.each(['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.169.254', '0.0.0.0', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '100.64.0.1'])(
    'bloqueia IP não público %s',
    (ip) => expect(isPublicIp(ip)).toBe(false),
  );

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('aceita IP público %s', (ip) => expect(isPublicIp(ip)).toBe(true));

  it('bloqueia localhost e IPs privados como host', async () => {
    await expect(assertPublicHost('localhost')).rejects.toMatchObject({ code: 'BLOCKED_URL' });
    await expect(assertPublicHost('127.0.0.1')).rejects.toMatchObject({ code: 'BLOCKED_URL' });
    await expect(assertPublicHost('[::1]')).rejects.toMatchObject({ code: 'BLOCKED_URL' });
    await expect(assertPublicHost('metadata.internal')).rejects.toMatchObject({ code: 'BLOCKED_URL' });
  });

  it('aceita IP público literal', async () => {
    await expect(assertPublicHost('8.8.8.8')).resolves.toBeUndefined();
  });
});
