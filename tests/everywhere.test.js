import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { faceRuntime } from '../src/face.js';
import { cookiePair, listen, multipart, request } from './http.js';
import { makeJpeg } from './jpeg.js';

function descriptor() {
  return Array.from({ length: 128 }, (_, index) => ((index % 5) - 2) / 20);
}

function face(ear, yaw, pitch = 0) {
  return { descriptor: descriptor(), ear, yaw, pitch, score: 0.9, box: { width: 180, height: 200 } };
}

test('Everywhere mengizinkan absen di luar pagar dan lokasi biasa tetap ditolak', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hadir-everywhere-'));
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
    const adminLogin = await request(server, {
      method: 'POST',
      path: '/api/admin/masuk',
      json: { phone: '081299000001', pin: '9081' }
    });
    const adminCookie = cookiePair(adminLogin.setCookie, 'hadir_admin');
    await request(server, {
      method: 'PUT',
      path: '/api/admin/pengaturan',
      cookie: adminCookie,
      json: { detectionCooldownSeconds: 0 }
    });
    const daftar = await request(server, { path: '/api/admin/karyawan', cookie: adminCookie });
    const nisa = daftar.data.karyawan.find((item) => item.name === 'Nisa Putri');
    const andi = daftar.data.karyawan.find((item) => item.name === 'Andi Wijaya');
    assert.equal(daftar.data.lokasi.some((item) => item.scope === 'everywhere' || item.name === 'Everywhere'), false);

    const login = await request(server, {
      method: 'POST',
      path: '/api/karyawan/masuk',
      json: { phone: nisa.phone, pin: '908172' }
    });
    const employeeCookie = cookiePair(login.setCookie, 'hadir_karyawan');
    const outside = await request(server, {
      path: '/api/karyawan/cek-lokasi?lat=-6.9&lng=107.6&akurasi=15',
      cookie: employeeCookie
    });
    assert.equal(outside.data.error, 'outside_geofence');

    const kosong = await request(server, {
      method: 'PATCH',
      path: `/api/admin/karyawan/${nisa.id}`,
      cookie: adminCookie,
      json: {
        name: nisa.name,
        phone: nisa.phone,
        businessId: nisa.businessId,
        shiftStart: nisa.shiftStart,
        graceMinutes: nisa.graceMinutes,
        locationIds: [],
        everywhere: false,
        active: true
      }
    });
    assert.equal(kosong.status, 400);
    assert.equal(kosong.data.error, 'need_location');
    const hpSalah = await request(server, {
      method: 'POST',
      path: '/api/admin/karyawan',
      cookie: adminCookie,
      json: {
        name: 'Sari Baru',
        phone: '12345',
        pin: '1357',
        businessId: 'toko',
        graceMinutes: 10,
        locationIds: [nisa.locationIds[0]].filter(Boolean),
        everywhere: false,
        active: true
      }
    });
    assert.equal(hpSalah.status, 400);
    assert.equal(hpSalah.data.error, 'phone_invalid');

    const bebas = await request(server, {
      method: 'PATCH',
      path: `/api/admin/karyawan/${nisa.id}`,
      cookie: adminCookie,
      json: {
        name: nisa.name,
        phone: nisa.phone,
        businessId: nisa.businessId,
        shiftStart: nisa.shiftStart,
        graceMinutes: nisa.graceMinutes,
        locationIds: [],
        everywhere: true,
        active: true
      }
    });
    assert.equal(bebas.status, 200, JSON.stringify(bebas.data));
    assert.equal(bebas.data.karyawan.everywhere, true);
    assert.deepEqual(bebas.data.karyawan.locationIds, []);

    const jauh = await request(server, {
      path: '/api/karyawan/cek-lokasi?lat=-6.9&lng=107.6&akurasi=15',
      cookie: employeeCookie
    });
    assert.equal(jauh.data.ok, true);
    assert.equal(jauh.data.everywhere, true);
    assert.equal(jauh.data.lokasi.nama, 'Everywhere');
    assert.equal(jauh.data.jarakMeter, null);

    const lemah = await request(server, {
      path: '/api/karyawan/cek-lokasi?lat=-6.9&lng=107.6&akurasi=250',
      cookie: employeeCookie
    });
    assert.equal(lemah.data.error, 'gps_inaccurate');

    const poses = ['lurus', 'kiri', 'kanan', 'atas', 'bawah'];
    queue.push(face(0.3, 0), face(0.3, -0.22), face(0.3, 0.22), face(0.3, 0, -0.12), face(0.3, 0, 0.12));
    const enrolled = await request(server, {
      method: 'POST',
      path: `/api/admin/karyawan/${nisa.id}/wajah`,
      cookie: adminCookie,
      form: multipart({ pose: poses }, poses.map((pose, index) => ({
        field: 'foto',
        filename: `${pose}.jpg`,
        buffer: makeJpeg(20 + index)
      })))
    });
    assert.equal(enrolled.status, 200, JSON.stringify(enrolled.data));

    const token = await request(server, {
      method: 'POST',
      path: '/api/karyawan/tantangan',
      cookie: employeeCookie,
      json: {}
    });
    queue.push(face(0.34, 0), face(0.14, 0), face(0.33, 0));
    const absen = await request(server, {
      method: 'POST',
      path: '/api/karyawan/absen',
      cookie: employeeCookie,
      form: multipart({
        action: 'in',
        token: token.data.token,
        lat: '-6.9',
        lng: '107.6',
        accuracy: '18'
      }, [1, 2, 3].map((seed) => ({ field: 'frame', filename: `${seed}.jpg`, buffer: makeJpeg(seed) })))
    });
    assert.equal(absen.status, 200, JSON.stringify(absen.data));
    assert.equal(absen.data.absensi.everywhere, true);
    assert.equal(absen.data.absensi.locationName, 'Everywhere');
    assert.equal(absen.data.absensi.inLat, -6.9);
    assert.equal(absen.data.absensi.inLng, 107.6);
    assert.equal(absen.data.absensi.inAccuracy, 18);

    const riwayat = await request(server, { path: '/api/admin/absensi', cookie: adminCookie });
    const baris = riwayat.data.absensi.find((item) => item.id === absen.data.absensi.id);
    assert.equal(baris.locationName, 'Everywhere');
    assert.equal(baris.inLat, -6.9);
    assert.equal(baris.inAccuracy, 18);

    const hapus = await request(server, {
      method: 'DELETE',
      path: `/api/admin/lokasi/${absen.data.absensi.locationId}`,
      cookie: adminCookie
    });
    assert.equal(hapus.status, 400);

    const andiLogin = await request(server, {
      method: 'POST',
      path: '/api/karyawan/masuk',
      json: { phone: andi.phone, pin: '908172' }
    });
    const andiCookie = cookiePair(andiLogin.setCookie, 'hadir_karyawan');
    const andiJauh = await request(server, {
      path: '/api/karyawan/cek-lokasi?lat=-6.9&lng=107.6&akurasi=15',
      cookie: andiCookie
    });
    assert.equal(andiJauh.data.error, 'outside_geofence');
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
