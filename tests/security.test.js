import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertBootConfig } from '../src/secrets.js';
import { parseCompanyName } from '../src/settings.js';
import { faceRuntime } from '../src/face.js';
import { cookiePair, listen, multipart, request } from './http.js';
import { makeJpeg } from './jpeg.js';

test('production menolak sandi kosong, sandi bawaan, dan DEMO', () => {
  assert.throws(() => assertBootConfig({ NODE_ENV: 'production', ADMIN_PHONE: '', ADMIN_PIN: '', DEMO: '0' }));
  assert.throws(() => assertBootConfig({ NODE_ENV: 'production', ADMIN_PHONE: '081299000001', ADMIN_PIN: '12', DEMO: '0' }));
  assert.throws(() => assertBootConfig({ NODE_ENV: 'production', ADMIN_PHONE: '081299000001', ADMIN_PIN: '9081', DEMO: '1' }));
  const ok = assertBootConfig({ NODE_ENV: 'production', ADMIN_PHONE: '6281299000001', ADMIN_PIN: '9081', DEMO: '0' });
  assert.equal(ok.demo, false);
  assert.equal(ok.adminPhone, '081299000001');
  assert.equal(ok.adminPin.length, 4);
  const local = assertBootConfig({ NODE_ENV: 'test', DEMO: '1', DEMO_PIN: '908172', ADMIN_PHONE: '', ADMIN_PIN: '' });
  assert.equal(local.demo, true);
  assert.equal(parseCompanyName('<script>alert(1)</script>').ok, false);
  assert.equal(parseCompanyName('Toko Uji').name, 'Toko Uji');
});

function descriptor(shift = 0) {
  const values = Array.from({ length: 128 }, (_, index) => ((index % 5) - 2) / 20);
  values[0] += shift;
  return values;
}

function face(ear, yaw, shift = 0, pitch = 0) {
  return { descriptor: descriptor(shift), ear, yaw, pitch, score: 0.9, box: { width: 180, height: 200 } };
}

test('wajah saja tidak masuk, kunci PIN, dan nama perusahaan aman', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hadir-secure-'));
  const previous = {
    DATA_DIR: process.env.DATA_DIR,
    NODE_ENV: process.env.NODE_ENV,
    DEMO: process.env.DEMO,
    DEMO_PIN: process.env.DEMO_PIN,
    ADMIN_PHONE: process.env.ADMIN_PHONE,
    ADMIN_PIN: process.env.ADMIN_PIN
  };
  process.env.DATA_DIR = dir;
  process.env.NODE_ENV = 'test';
  process.env.DEMO = '1';
  process.env.DEMO_PIN = '908172';
  process.env.ADMIN_PHONE = '081299000001';
  process.env.ADMIN_PIN = '9081';
  const queue = [];
  faceRuntime.detect = async () => queue.shift();
  const { createApp } = await import('../src/app.js');
  const app = await createApp();
  const server = await listen(app);
  try {
    const bare = await request(server, {
      method: 'POST',
      path: '/api/karyawan/kenali',
      form: multipart({ lat: '0', lng: '0', accuracy: '10' }, [])
    });
    assert.equal(bare.status, 401);
    assert.equal(bare.data.error, 'perlu_faktor');
    assert.equal(bare.setCookie.some((item) => item.startsWith('hadir_admin=')), false);
    const adminAfterFace = await request(server, { path: '/api/admin/saya' });
    assert.equal(adminAfterFace.status, 401);

    const adminLogin = await request(server, {
      method: 'POST',
      path: '/api/admin/masuk',
      json: { phone: '6281299000001', pin: '9081' }
    });
    assert.equal(adminLogin.data.perluGantiSandi, false);
    const adminCookie = cookiePair(adminLogin.setCookie, 'hadir_admin');
    const board = await request(server, { path: '/api/admin/hari-ini', cookie: adminCookie });
    assert.equal(board.status, 200, JSON.stringify(board.data));
    const changed = await request(server, {
      method: 'POST',
      path: '/api/admin/pin',
      cookie: adminCookie,
      json: { pin: '4321' }
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));

    for (let i = 0; i < 5; i += 1) {
      const bad = await request(server, {
        method: 'POST',
        path: '/api/karyawan/masuk',
        json: { phone: '081210000003', pin: '0000' }
      });
      assert.equal(bad.status, 401);
    }
    const locked = await request(server, {
      method: 'POST',
      path: '/api/karyawan/masuk',
      json: { phone: '081210000003', pin: '908172' }
    });
    assert.equal(locked.status, 429);
    assert.equal(locked.data.error, 'locked');

    const xss = await request(server, {
      method: 'PUT',
      path: '/api/admin/pengaturan',
      cookie: adminCookie,
      json: { companyName: '<script>alert(1)</script>' }
    });
    assert.equal(xss.status, 400);
    const renamed = await request(server, {
      method: 'PUT',
      path: '/api/admin/pengaturan',
      cookie: adminCookie,
      json: { companyName: 'Toko Uji' }
    });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
    assert.equal(renamed.data.companyName, 'Toko Uji');
    const kiosk = await request(server, { path: '/api/kiosk/pengaturan' });
    assert.equal(kiosk.data.companyName, 'Toko Uji');
    const manifest = await request(server, { path: '/manifest.webmanifest' });
    const manifestText = manifest.buf.toString('utf8');
    assert.equal(manifestText.includes('<script>'), false);
    assert.match(manifestText, /Toko Uji/);

    const karyawan = await request(server, { path: '/api/admin/karyawan', cookie: adminCookie });
    const nisa = karyawan.data.karyawan.find((item) => item.name === 'Andi Wijaya');
    const poses = ['lurus', 'kiri', 'kanan', 'atas', 'bawah'];
    queue.push(face(0.3, 0), face(0.3, -0.2), face(0.3, 0.2), face(0.3, 0, 0, -0.12), face(0.3, 0, 0, 0.12));
    const enrolled = await request(server, {
      method: 'POST',
      path: `/api/admin/karyawan/${nisa.id}/wajah`,
      cookie: adminCookie,
      form: multipart({ pose: poses }, poses.map((pose, index) => ({
        field: 'foto',
        filename: `${pose}.jpg`,
        buffer: makeJpeg(30 + index)
      })))
    });
    assert.equal(enrolled.status, 200, JSON.stringify(enrolled.data));

    const employeeLogin = await request(server, {
      method: 'POST',
      path: '/api/karyawan/masuk',
      json: { phone: '081210000002', pin: '908172' }
    });
    assert.equal(employeeLogin.status, 200, JSON.stringify(employeeLogin.data));
    const employeeCookie = cookiePair(employeeLogin.setCookie, 'hadir_karyawan');
    queue.push(face(0.34, 0, 2), face(0.14, 0, 2), face(0.33, 0, 2));
    const stranger = await request(server, {
      method: 'POST',
      path: '/api/karyawan/kenali',
      cookie: employeeCookie,
      form: multipart({
        lat: '0',
        lng: '0',
        accuracy: '12'
      }, [1, 2, 3].map((seed) => ({ field: 'frame', filename: `${seed}.jpg`, buffer: makeJpeg(seed) })))
    });
    assert.equal(stranger.data.error, 'face_mismatch');
    const saya = await request(server, { path: '/api/karyawan/saya', cookie: employeeCookie });
    assert.equal(saya.data.karyawan.name, 'Andi Wijaya');
    const adminStill = await request(server, { path: '/api/admin/saya', cookie: employeeCookie });
    assert.equal(adminStill.status, 401);
    for (let i = 0; i < 5; i += 1) {
      const badAdmin = await request(server, {
        method: 'POST',
        path: '/api/admin/masuk',
        json: { phone: '081211110000', pin: '1111' }
      });
      assert.equal(badAdmin.status, 401);
    }
    const adminLocked = await request(server, {
      method: 'POST',
      path: '/api/admin/masuk',
      json: { phone: '081211110000', pin: '1111' }
    });
    assert.equal(adminLocked.status, 429);
    assert.equal(adminLocked.data.error, 'locked');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    app.locals.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
