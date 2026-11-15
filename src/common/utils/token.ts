import { createHash, timingSafeEqual } from 'crypto';

/** Comparação de token em tempo constante. */
export function tokensMatch(provided: string | undefined | null, expected: string): boolean {
  if (!provided) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function extractToken(headers: Record<string, any>): string | undefined {
  const auth = headers['authorization'];
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const x = headers['x-api-token'];
  return typeof x === 'string' ? x : undefined;
}
