import { createHash } from 'node:crypto';
import jpeg from 'jpeg-js';

const decoder = jpeg.default || jpeg;

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function validateJpeg(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 400 || buffer.length > 1_500_000) {
    return { ok: false, error: 'bad_image' };
  }
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return { ok: false, error: 'bad_image' };
  let decoded;
  try {
    decoded = decoder.decode(buffer, { maxMemoryUsageInMB: 24, maxResolutionInMP: 4, useTArray: true });
  } catch {
    return { ok: false, error: 'bad_image' };
  }
  const { width, height } = decoded || {};
  if (!width || !height || width < 80 || height < 80 || width > 2000 || height > 2000) {
    return { ok: false, error: 'bad_image' };
  }
  return { ok: true, width, height, hash: sha256(buffer) };
}
