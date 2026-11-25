import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import jpeg from 'jpeg-js';
import { faceRuntime } from '../src/face.js';
import { saveJpeg } from '../src/photos.js';
import { purgeExpiredPhotos } from '../src/retention.js';
import { cookiePair, listen, multipart, request } from './http.js';
import { makeJpeg } from './jpeg.js';

const encoder = jpeg.default || jpeg;

function descriptor(shift = 0) {
  const values = Array.from({ length: 128 }, (_, index) => ((index % 5) - 2) / 20);
  values[0] += shift;
  return values;
}

test('foto absen masuk ke server, hanya admin, dan memicu notifikasi', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hadir-foto-'));
  const hooks = [];
  const sink = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      hooks.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise((resolve) => sink.listen(0, '127.0.0.1', resolve));
  process.env.DATA_DIR = dir;
  process.env.NODE_ENV = 'test';
  process.env.COOKIE_SECURE = '0';
  process.env.DEMO = '1';
  process.env.DEMO_PIN = '908172';
  process.env.ADMIN_PHONE = '081299000001';
  process.env.ADMIN_PIN = '9081';
  process.env.WA_NOTIFY_URL = `http://127.0.0.1:${sink.address().port}/hook`;
  process.env.WA_NOTIFY_TOKEN = '';
  process.env.VAPID_PUBLIC_KEY = '';
  process.env.VAPID_PRIVATE_KEY = '';
  process.env.VAPID_SUBJECT = '';
  delete process.env.UPLOAD_DIR;

  const lebar = Buffer.alloc(900 * 700 * 4, 90);
  for (let i = 3; i < lebar.length; i += 4) lebar[i] = 255;
  const besar = Buffer.from(encoder.encode({ data: lebar, width: 900, height: 700 }, 80).data);
  const { loadImage } = await import('@napi-rs/canvas');
  const config = { uploadDir: path.join(dir, 'uploads'), dataDir: dir };
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const relative = await saveJpeg(config, besar);
  const penuh = path.join(config.uploadDir, relative);
  const gambar = await loadImage(penuh);
  assert.equal(gambar.width, 640);
  assert.ok(gambar.height < 640);
  assert.equal(fs.readFileSync(penuh)[0], 0xff);

  const queue = [];
  faceRuntime.detect = async () => {
    const next = queue.shift();
    assert.ok(next, 'deteksi wajah dipanggil tanpa skrip');
    return next;
  };
  const { createApp } = await import('../src/app.js');
  const app = await createApp();
  const server = await listen(app);
  try {
    const adminLogin = await request(server, {
      method: 'POST',
      path: '/api/admin/masuk',
      json: { phone: '081299000001', pin: '9081' }
    });
    const adminCookie = cookiePair(adminLogin.setCookie, 'hadir_admin');
    const push = await request(server, { path: '/api/admin/push', cookie: adminCookie });
    assert.equal(push.data.aktif, false);
    const daftar = await request(server, { path: '/api/admin/karyawan', cookie: adminCookie });
    const nisa = daftar.data.karyawan.find((item) => item.name === 'Nisa Putri');
    const toko = daftar.data.lokasi.find((item) => item.name.includes('DBLESS'));
    queue.push({ descriptor: descriptor(), ear: 0.3, yaw: 0.4, pitch: 0, score: 0.9, box: { width: 40, height: 40 } });
    const enrolled = await request(server, {
      method: 'POST',
      path: `/api/admin/karyawan/${nisa.id}/wajah`,
      cookie: adminCookie,
      form: multipart({}, [{ field: 'foto', filename: 'depan.jpg', buffer: makeJpeg(3) }])
    });
    assert.equal(enrolled.status, 200, JSON.stringify(enrolled.data));
    const login = await request(server, {
      method: 'POST',
      path: '/api/karyawan/masuk',
      json: { phone: nisa.phone, pin: '908172' }
    });
    const employeeCookie = cookiePair(login.setCookie, 'hadir_karyawan');
    const tantangan = await request(server, {
      method: 'POST',
      path: '/api/karyawan/tantangan',
      cookie: employeeCookie,
      json: {}
    });
    queue.push({ descriptor: descriptor(), ear: 0.3, yaw: 0.6, pitch: 0.4, score: 0.8, box: { width: 30, height: 30 } });
    const clockIn = await request(server, {
      method: 'POST',
      path: '/api/karyawan/absen',
      cookie: employeeCookie,
      form: multipart({
        action: 'in',
        token: tantangan.data.token,
        lat: String(toko.latitude),
        lng: String(toko.longitude),
        accuracy: '12'
      }, [{ field: 'frame', filename: 'wajah.jpg', buffer: makeJpeg(8) }])
    });
    assert.equal(clockIn.status, 200, JSON.stringify(clockIn.data));
    assert.equal(clockIn.data.absensi.inPhoto, true);
    const id = clockIn.data.absensi.id;
    const tertutup = await request(server, { path: `/api/foto/absensi/${id}/masuk`, cookie: employeeCookie });
    assert.equal(tertutup.status, 403);
    const foto = await request(server, { path: `/api/foto/absensi/${id}/masuk`, cookie: adminCookie });
    assert.equal(foto.status, 200);
    assert.equal(foto.buf[0], 0xff);
    const lonceng = await request(server, { path: '/api/admin/notifikasi', cookie: adminCookie });
    assert.equal(lonceng.data.belumBaca, 1);
    assert.equal(lonceng.data.notifikasi[0].employeeName, 'Nisa Putri');
    assert.equal(lonceng.data.notifikasi[0].action, 'in');
    assert.equal(hooks.length, 1);
    assert.equal(hooks[0].nama, 'Nisa Putri');
    assert.equal(hooks[0].aksi, 'masuk');
    assert.equal(hooks[0].jenis, 'absen');
    const baca = await request(server, { method: 'POST', path: '/api/admin/notifikasi/baca', cookie: adminCookie, json: {} });
    assert.equal(baca.data.belumBaca, 0);

    const row = app.locals.db.prepare('SELECT in_photo FROM attendance WHERE id = ?').get(id);
    const berkas = path.join(app.locals.config.uploadDir, row.in_photo);
    assert.equal(fs.existsSync(berkas), true);
    app.locals.db.prepare('UPDATE attendance SET clock_in_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', id);
    const dihapus = purgeExpiredPhotos(app.locals.db, app.locals.config, 90, new Date('2026-11-25T00:00:00.000Z'));
    assert.equal(dihapus, 1);
    assert.equal(fs.existsSync(berkas), false);
    const sisa = await request(server, { path: `/api/foto/absensi/${id}/masuk`, cookie: adminCookie });
    assert.equal(sisa.status, 404);
  } finally {
    sink.close();
    server.close();
  }
});
