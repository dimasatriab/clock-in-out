import path from 'node:path';
import { assertBootConfig } from './secrets.js';

export function getConfig() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const boot = assertBootConfig(process.env);
  const dataDir = path.resolve(process.env.DATA_DIR || './data');
  const faceMaxDistance = numberEnv('FACE_MATCH_MAX_DISTANCE', 0.5);
  const maxGpsAccuracy = numberEnv('MAX_GPS_ACCURACY_METERS', 100);
  return {
    nodeEnv,
    port: numberEnv('PORT', 3000),
    host: process.env.HOST || '0.0.0.0',
    dataDir,
    uploadDir: path.resolve(process.env.UPLOAD_DIR || path.join(dataDir, 'uploads')),
    waNotifyUrl: String(process.env.WA_NOTIFY_URL || '').trim(),
    waNotifyToken: String(process.env.WA_NOTIFY_TOKEN || '').trim(),
    vapidPublic: String(process.env.VAPID_PUBLIC_KEY || '').trim(),
    vapidPrivate: String(process.env.VAPID_PRIVATE_KEY || '').trim(),
    vapidSubject: String(process.env.VAPID_SUBJECT || '').trim(),
    cookieSecure: process.env.COOKIE_SECURE === '1',
    trustProxy: process.env.TRUST_PROXY === '1',
    faceMaxDistance: clamp(faceMaxDistance, 0.3, 0.8),
    maxGpsAccuracy: clamp(maxGpsAccuracy, 20, 500),
    adminPhone: boot.adminPhone,
    adminPin: boot.adminPin,
    demo: boot.demo,
    demoPin: boot.demoPin,
    publicDir: path.resolve('public'),
    modelPackageDir: ''
  };
}

function numberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
