import { randomBytes } from 'crypto';

/** Stable prefixed IDs, e.g. ord_k3x9f2a1b8c4d */
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function newId(prefix: string): string {
  const bytes = randomBytes(9);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % 36];
  return `${prefix}_${s}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
