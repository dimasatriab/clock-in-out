import { createHash, randomBytes } from 'node:crypto';
import { PESAN } from './pesan.js';

export function tokenPair() {
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

export function hashToken(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

export function readCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    cookies[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return cookies;
}

export function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function sendOk(res, data = {}) {
  res.json({ ok: true, ...data });
}

export function sendError(res, code, status = 400, extra = {}) {
  res.status(status).json({
    ok: false,
    error: code,
    pesan: PESAN[code] || PESAN.server_error,
    ...extra
  });
}

export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function wantsJson(req) {
  return req.headers['x-hadir'] === '1';
}
