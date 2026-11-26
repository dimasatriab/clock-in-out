import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { jakartaParts, pad2 } from './time.js';

const MAX_SIDE = 640;
const JPEG_QUALITY = 70;

export async function compressJpeg(buffer) {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const image = await loadImage(buffer);
  const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  canvas.getContext('2d').drawImage(image, 0, 0, width, height);
  return canvas.toBuffer('image/jpeg', JPEG_QUALITY);
}

export async function saveJpeg(config, buffer) {
  const jpeg = await compressJpeg(buffer);
  const parts = jakartaParts(new Date());
  const dir = path.join(config.uploadDir, String(parts.year), pad2(parts.month));
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${Date.now()}-${randomBytes(6).toString('hex')}.jpg`;
  const full = path.join(dir, filename);
  fs.writeFileSync(full, jpeg);
  return path.relative(config.uploadDir, full);
}

export function resolveUpload(config, relativePath) {
  if (!relativePath || String(relativePath).includes('\0') || String(relativePath).includes('..')) return null;
  const roots = [path.resolve(config.uploadDir), path.resolve(config.dataDir, 'uploads')];
  const candidates = [
    path.resolve(config.uploadDir, relativePath),
    path.resolve(config.dataDir, relativePath)
  ];
  for (const full of candidates) {
    const allowed = roots.some((root) => full === root || full.startsWith(`${root}${path.sep}`));
    if (!allowed || !fs.existsSync(full)) continue;
    return full;
  }
  return null;
}

export function removeUpload(config, relativePath) {
  const full = resolveUpload(config, relativePath);
  if (full) fs.rmSync(full, { force: true });
}
