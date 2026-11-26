import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

export function hashSecret(secret) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(secret), salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifySecret(secret, stored) {
  const [algo, salt, hash] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const actual = scryptSync(String(secret), salt, 32);
  const expected = Buffer.from(hash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

let dummyHash;
export function dummySecretHash() {
  if (!dummyHash) dummyHash = hashSecret('bukan-rahasia-sungguhan');
  return dummyHash;
}
