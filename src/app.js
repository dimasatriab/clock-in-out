import express from 'express';
import path from 'node:path';
import { getConfig } from './config.js';
import { openDatabase } from './db.js';
import { seedIfEmpty, sweepAutoClockOut } from './repo.js';
import { registerRoutes } from './routes.js';
import { sendError } from './http.js';

export async function createApp() {
  const config = getConfig();
  const db = openDatabase(config);
  seedIfEmpty(db, config);
  sweepAutoClockOut(db, config);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ? 1 : false);
  app.locals.db = db;
  app.locals.config = config;

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
      "font-src 'self'",
      "connect-src 'self'",
      "media-src 'self' blob:",
      "worker-src 'self'",
      "manifest-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'"
    ].join('; '));
    next();
  });

  app.use(express.json({ limit: '100kb' }));
  registerRoutes(app);

  app.use(express.static(config.publicDir, {
    index: 'index.html',
    maxAge: config.nodeEnv === 'production' ? '1h' : 0
  }));

  app.use('/api', (req, res) => sendError(res, 'not_found', 404));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error(error);
    sendError(res, 'server_error', 500);
  });
  return app;
}

export function publicFile(name) {
  return path.join(getConfig().publicDir, name);
}
