import { lookup as dnsLookup, LookupAddress } from 'dns';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import * as ipaddr from 'ipaddr.js';
import { isIP } from 'net';
import { ChupaError } from './errors';

/** Retorna true se o IP for público (unicast roteável na internet). */
export function isPublicIp(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return false;
  let addr = ipaddr.parse(ip);
  if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
    addr = (addr as ipaddr.IPv6).toIPv4Address();
  }
  return addr.range() === 'unicast';
}

const BLOCKED_HOSTNAMES = /(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/i;

/**
 * Garante que o host aponta apenas para IPs públicos.
 * Lança ChupaError('BLOCKED_URL') para localhost, IPs privados, link-local, metadata de cloud etc.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.test(host)) throw new ChupaError('BLOCKED_URL', `Host bloqueado: ${host}`);
  if (isIP(host)) {
    if (!isPublicIp(host)) throw new ChupaError('BLOCKED_URL', `IP não público: ${host}`);
    return;
  }
  const addresses = await new Promise<LookupAddress[]>((resolve, reject) =>
    dnsLookup(host, { all: true }, (err, res) => (err ? reject(err) : resolve(res))),
  ).catch(() => {
    throw new ChupaError('INVALID_URL', `Não foi possível resolver ${host}`);
  });
  if (!addresses.length || addresses.some((a) => !isPublicIp(a.address))) {
    throw new ChupaError('BLOCKED_URL', `Host ${host} resolve para endereço não público`);
  }
}

/**
 * lookup usado pelos agents HTTP: valida o IP no momento da conexão,
 * protegendo também contra DNS rebinding.
 */
export const safeLookup: any = (hostname: string, options: any, callback: any) => {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'function' ? {} : (options ?? {});
  dnsLookup(hostname, { ...opts, all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return cb(err);
    const list = addresses ?? [];
    const bad = list.find((a) => !isPublicIp(a.address));
    if (!list.length || bad) {
      return cb(new ChupaError('BLOCKED_URL', `Conexão bloqueada para ${hostname} (${bad?.address ?? 'sem IP'})`));
    }
    if (opts.all) return cb(null, list);
    return cb(null, list[0].address, list[0].family);
  });
};

export const safeHttpAgent = new HttpAgent({ lookup: safeLookup, keepAlive: false });
export const safeHttpsAgent = new HttpsAgent({ lookup: safeLookup, keepAlive: false });
