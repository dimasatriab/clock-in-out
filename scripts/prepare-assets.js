import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyMatch(fromDir, toDir, predicate) {
  if (!fs.existsSync(fromDir)) return;
  fs.mkdirSync(toDir, { recursive: true });
  for (const name of fs.readdirSync(fromDir)) {
    if (!predicate(name)) continue;
    const from = path.join(fromDir, name);
    if (fs.statSync(from).isDirectory()) continue;
    copyFile(from, path.join(toDir, name));
  }
}

function crc32(buffer) {
  let crc = ~0;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const cx = size / 2;
      const cy = size / 2;
      const distance = Math.hypot(x - cx, y - cy);
      const radius = size * 0.3;
      let red = 8;
      let green = 63;
      let blue = 54;
      if (distance < radius) {
        red = 255;
        green = 252;
        blue = 247;
      }
      const inStem = distance < radius * 0.78 && Math.abs(x - cx) > radius * 0.28 && Math.abs(x - cx) < radius * 0.5 && Math.abs(y - cy) < radius * 0.55;
      const inBar = distance < radius * 0.78 && Math.abs(y - cy) < radius * 0.09 && Math.abs(x - cx) < radius * 0.5;
      if (inStem || inBar) {
        red = 12;
        green = 110;
        blue = 98;
      }
      const index = row + 1 + x * 4;
      raw[index] = red;
      raw[index + 1] = green;
      raw[index + 2] = blue;
      raw[index + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

export async function prepareAssets() {
  const faceRoot = path.dirname(require.resolve('@vladmandic/face-api/package.json'));
  const modelNames = [
    'tiny_face_detector_model-weights_manifest.json',
    'tiny_face_detector_model.bin',
    'face_landmark_68_model-weights_manifest.json',
    'face_landmark_68_model.bin',
    'face_recognition_model-weights_manifest.json',
    'face_recognition_model.bin'
  ];
  for (const name of modelNames) {
    copyFile(path.join(faceRoot, 'model', name), path.join(publicDir, 'models', name));
  }
  copyFile(path.join(faceRoot, 'dist', 'face-api.js'), path.join(publicDir, 'vendor', 'face-api.js'));

  const leaflet = path.dirname(require.resolve('leaflet/package.json'));
  copyFile(path.join(leaflet, 'dist', 'leaflet.js'), path.join(publicDir, 'vendor', 'leaflet', 'leaflet.js'));
  copyFile(path.join(leaflet, 'dist', 'leaflet.css'), path.join(publicDir, 'vendor', 'leaflet', 'leaflet.css'));
  copyMatch(path.join(leaflet, 'dist', 'images'), path.join(publicDir, 'vendor', 'leaflet', 'images'), () => true);

  const fontDir = path.join(path.dirname(require.resolve('@fontsource/plus-jakarta-sans/package.json')), 'files');
  for (const weight of [400, 500, 600, 700]) {
    copyFile(
      path.join(fontDir, `plus-jakarta-sans-latin-${weight}-normal.woff2`),
      path.join(publicDir, 'fonts', `plus-jakarta-sans-latin-${weight}-normal.woff2`)
    );
  }

  const iconDir = path.join(publicDir, 'icons');
  fs.mkdirSync(iconDir, { recursive: true });
  for (const size of [32, 192, 512]) {
    const file = path.join(iconDir, size === 32 ? 'favicon.png' : `icon-${size}.png`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, png(size));
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await prepareAssets();
  console.log('Aset publik siap.');
}

function pathToFileURL(file) {
  return new URL(`file://${path.resolve(file)}`);
}
