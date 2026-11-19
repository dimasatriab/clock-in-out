import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { jakartaParts, pad2 } from './time.js';

export function saveJpeg(config, buffer) {
  const parts = jakartaParts(new Date());
  const dir = path.join(config.dataDir, 'uploads', String(parts.year), pad2(parts.month));
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${Date.now()}-${randomBytes(6).toString('hex')}.jpg`;
  const full = path.join(dir, filename);
  fs.writeFileSync(full, buffer);
  return path.relative(config.dataDir, full);
}

export function resolveUpload(config, relativePath) {
  if (!relativePath || String(relativePath).includes('\0')) return null;
  const root = path.resolve(config.dataDir, 'uploads');
  const full = path.resolve(config.dataDir, relativePath);
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) return null;
  if (!fs.existsSync(full)) return null;
  return full;
}

export function removeUpload(config, relativePath) {
  const full = resolveUpload(config, relativePath);
  if (full) fs.rmSync(full, { force: true });
}
