import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { faceRuntime } from '../src/face.js';
import { saveJpeg } from '../src/photos.js';
import { faceSamples, insertClockIn } from '../src/repo.js';
import { cookiePair, listen, multipart, request } from './http.js';
import { makeJpeg } from './jpeg.js';

function descriptor() {
  return Array.from({ length: 128 }, (_, index) => ((index % 5) - 2) / 20);
}

test('hapus karyawan dan lokasi menjaga riwayat', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hadir-hapus-'));
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
  faceRuntime.detect = async () => ({
    descriptor: descriptor(),
    ear: 0.3,
    yaw: 0,
    pitch: 0,
    score: 0.9,
    box: { width: 180, height: 200 }
  });
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
    const daftar = await request(server, { path: '/api/admin/karyawan', cookie: adminCookie });
    const nisa = daftar.data.karyawan.find((item) => item.name === 'Nisa Putri');
    const adminOrang = daftar.data.karyawan.find((item) => item.phone === '081299000001');
    const toko = daftar.data.lokasi.find((item) => item.name.includes('DBLESS'));
    const photo = saveJpeg(app.locals.config, makeJpeg(9));
    insertClockIn(app.locals.db, {
      employeeId: nisa.id,
      locationId: toko.id,
      clockInAt: new Date().toISOString(),
      lat: toko.latitude,
      lng: toko.longitude,
      accuracy: 12,
      distanceMeters: 4,
      photo,
      frames: [photo],
      faceDistance: 0.1,
      liveness: 'wajah',
      lateMinutes: 0
    });
    const enrolled = await request(server, {
      method: 'POST',
      path: `/api/admin/karyawan/${nisa.id}/wajah`,
      cookie: adminCookie,
      form: multipart({}, [{ field: 'foto', filename: 'depan.jpg', buffer: makeJpeg(11) }])
    });
    assert.equal(enrolled.status, 200, JSON.stringify(enrolled.data));
    assert.equal(faceSamples(app.locals.db, nisa.id).length, 1);
    const masuk = await request(server, {
      method: 'POST',
      path: '/api/karyawan/masuk',
      json: { phone: nisa.phone, pin: '908172' }
    });
    const employeeCookie = cookiePair(masuk.setCookie, 'hadir_karyawan');
    assert.equal((await request(server, { path: '/api/karyawan/saya', cookie: employeeCookie })).status, 200);

    const diri = await request(server, {
      method: 'DELETE',
      path: `/api/admin/karyawan/${adminOrang.id}`,
      cookie: adminCookie
    });
    assert.equal(diri.status, 403);
    assert.equal(diri.data.error, 'cannot_delete_self');

    const dampak = await request(server, { path: `/api/admin/lokasi/${toko.id}/dampak`, cookie: adminCookie });
    assert.equal(dampak.status, 200, JSON.stringify(dampak.data));
    assert.equal(dampak.data.tanpaLokasi.includes('Nisa Putri'), true);

    const hapusOrang = await request(server, {
      method: 'DELETE',
      path: `/api/admin/karyawan/${nisa.id}`,
      cookie: adminCookie
    });
    assert.equal(hapusOrang.status, 200, JSON.stringify(hapusOrang.data));
    const sesudah = await request(server, { path: '/api/admin/karyawan', cookie: adminCookie });
    assert.equal(sesudah.data.karyawan.some((item) => item.id === nisa.id), false);
    assert.equal(faceSamples(app.locals.db, nisa.id).length, 0);
    assert.equal((await request(server, { path: '/api/karyawan/saya', cookie: employeeCookie })).status, 401);
    const riwayat = await request(server, { path: '/api/admin/absensi', cookie: adminCookie });
    const baris = riwayat.data.absensi.find((item) => item.employeeId === nisa.id);
    assert.equal(baris.employeeName, 'Nisa Putri (dihapus)');
    assert.equal(baris.locationName, toko.name);

    const hapusTempat = await request(server, {
      method: 'DELETE',
      path: `/api/admin/lokasi/${toko.id}`,
      cookie: adminCookie
    });
    assert.equal(hapusTempat.status, 200, JSON.stringify(hapusTempat.data));
    const tempat = await request(server, { path: '/api/admin/lokasi', cookie: adminCookie });
    assert.equal(tempat.data.lokasi.some((item) => item.id === toko.id), false);
    const riwayatLagi = await request(server, { path: '/api/admin/absensi', cookie: adminCookie });
    assert.equal(riwayatLagi.data.absensi.find((item) => item.employeeId === nisa.id).locationName, toko.name);
    const andi = sesudah.data.karyawan.find((item) => item.name === 'Andi Wijaya');
    assert.equal(andi.locationIds.includes(toko.id), false);
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
