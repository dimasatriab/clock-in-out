import path from 'node:path';

export function getConfig() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const dataDir = path.resolve(process.env.DATA_DIR || './data');
  const faceMaxDistance = numberEnv('FACE_MATCH_MAX_DISTANCE', 0.5);
  const maxGpsAccuracy = numberEnv('MAX_GPS_ACCURACY_METERS', 100);
  return {
    nodeEnv,
    port: numberEnv('PORT', 3000),
    host: process.env.HOST || '0.0.0.0',
    dataDir,
    cookieSecure: process.env.COOKIE_SECURE === '1',
    trustProxy: process.env.TRUST_PROXY === '1',
    faceMaxDistance: clamp(faceMaxDistance, 0.3, 0.8),
    maxGpsAccuracy: clamp(maxGpsAccuracy, 20, 500),
    demoAdminUser: (process.env.DEMO_ADMIN_USER || 'admin').trim() || 'admin',
    demoAdminPassword: process.env.DEMO_ADMIN_PASSWORD || 'demo-admin-123',
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
