import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { faceRuntime } from '../src/face.js';
import { cookiePair, listen, multipart, request } from './http.js';
import { makeJpeg } from './jpeg.js';

function descriptor(shift = 0) {
  const values = Array.from({ length: 128 }, (_, index) => ((index % 5) - 2) / 20);
  values[0] += shift;
  return values;
}

function face(ear, yaw, shift = 0, pitch = 0) {
  return { descriptor: descriptor(shift), ear, yaw, pitch, score: 0.9, box: { width: 180, height: 200 } };
}

test('alur absen menolak lokasi, wajah, dan kedipan palsu', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hadir-'));
  process.env.DATA_DIR = dir;
  process.env.NODE_ENV = 'test';
  process.env.COOKIE_SECURE = '0';
  process.env.DEMO = '1';
  process.env.DEMO_PIN = '908172';
  process.env.ADMIN_USER = 'admin';
  process.env.ADMIN_PASSWORD = 'test-admin-pass';
  process.env.FACE_MATCH_MAX_DISTANCE = '0.5';
  process.env.MAX_GPS_ACCURACY_METERS = '100';

  const queue = [];
  faceRuntime.detect = async () => {
    const next = queue.shift();
    assert.ok(next, 'deteksi wajah dipanggil tanpa skrip');
    return next;
  };

  const { createApp } = await import('../src/app.js');
  const app = await createApp();
  const server = await listen(app);
  const photos = [1, 2, 3].map((seed) => makeJpeg(seed));

  function frames(specs) {
    queue.push(...specs);
    return photos.map((buffer, index) => ({ field: 'frame', filename: `wajah-${index}.jpg`, buffer }));
  }

  try {
    const badAdmin = await request(server, {
      method: 'POST',
      path: '/api/admin/masuk',
      json: { username: 'admin', password: 'salah-sekali' }
    });
    assert.equal(badAdmin.status, 401);

    const adminLogin = await request(server, {
      method: 'POST',
      path: '/api/admin/masuk',
      json: { username: 'admin', password: 'test-admin-pass' }
    });
    assert.equal(adminLogin.status, 200);
    assert.equal(adminLogin.data.perluGantiSandi, true);
    const adminCookie = cookiePair(adminLogin.setCookie, 'hadir_admin');
    const ganti = await request(server, {
      method: 'POST',
      path: '/api/admin/sandi',
      cookie: adminCookie,
      json: { password: 'ganti-admin-9' }
    });
    assert.equal(ganti.status, 200, JSON.stringify(ganti.data));
    const pengaturan = await request(server, {
      method: 'PUT',
      path: '/api/admin/pengaturan',
      cookie: adminCookie,
      json: { detectionCooldownSeconds: 0 }
    });
    assert.equal(pengaturan.status, 200, JSON.stringify(pengaturan.data));

    const karyawan = await request(server, { path: '/api/admin/karyawan', cookie: adminCookie });
    const nisa = karyawan.data.karyawan.find((item) => item.name === 'Nisa Putri');
    const toko = karyawan.data.lokasi.find((item) => item.name.includes('DBLESS'));
    assert.ok(nisa);
    assert.ok(toko);

    const employeeLogin = await request(server, {
      method: 'POST',
      path: '/api/karyawan/masuk',
      json: { phone: '081210000001', pin: '908172' }
    });
    assert.equal(employeeLogin.status, 200);
    const employeeCookie = cookiePair(employeeLogin.setCookie, 'hadir_karyawan');

    const inside = await request(server, {
      path: `/api/karyawan/cek-lokasi?lat=${toko.latitude}&lng=${toko.longitude}&akurasi=12`,
      cookie: employeeCookie
    });
    assert.equal(inside.data.ok, true);
    assert.equal(inside.data.lokasi.id, toko.id);

    const outside = await request(server, {
      path: '/api/karyawan/cek-lokasi?lat=-6.5&lng=106.827153&akurasi=12',
      cookie: employeeCookie
    });
    assert.equal(outside.data.error, 'outside_geofence');

    const weak = await request(server, {
      path: `/api/karyawan/cek-lokasi?lat=${toko.latitude}&lng=${toko.longitude}&akurasi=180`,
      cookie: employeeCookie
    });
    assert.equal(weak.data.error, 'gps_inaccurate');

    async function token() {
      const response = await request(server, { method: 'POST', path: '/api/karyawan/tantangan', cookie: employeeCookie, json: {} });
      assert.equal(response.data.ok, true);
      return response.data.token;
    }

    async function absen(fields, specs) {
      return request(server, {
        method: 'POST',
        path: '/api/karyawan/absen',
        cookie: employeeCookie,
        form: multipart(fields, frames(specs))
      });
    }

    const baseFields = {
      action: 'in',
      token: await token(),
      lat: String(toko.latitude),
      lng: String(toko.longitude),
      accuracy: '12'
    };
    const notEnrolled = await absen(baseFields, [face(0.3, 0), face(0.3, 0), face(0.3, 0)]);
    assert.equal(notEnrolled.data.error, 'face_not_enrolled');
    assert.equal(queue.length, 3);
    queue.length = 0;

    const poseNama = ['lurus', 'kiri', 'kanan', 'atas', 'bawah'];
    const enrollShots = [4, 5, 6, 7, 8].map((seed, index) => ({
      field: 'foto',
      filename: `daftar-${index}.jpg`,
      buffer: makeJpeg(seed)
    }));
    queue.push(face(0.3, 0, 0, 0), face(0.3, -0.22, 0, 0), face(0.3, 0.22, 0, 0), face(0.3, 0, 0, -0.12), face(0.3, 0, 0, 0.12));
    const enrolled = await request(server, {
      method: 'POST',
      path: `/api/admin/karyawan/${nisa.id}/wajah`,
      cookie: adminCookie,
      form: multipart({ pose: poseNama }, enrollShots)
    });
    assert.equal(enrolled.status, 200, JSON.stringify(enrolled.data));
    assert.equal(enrolled.data.karyawan.faceSampleCount, 5);

    const inaccurate = await absen({
      ...baseFields,
      token: await token(),
      accuracy: '220'
    }, []);
    assert.equal(inaccurate.data.error, 'gps_inaccurate');

    const away = await absen({
      ...baseFields,
      token: await token(),
      lat: '-6.5'
    }, []);
    assert.equal(away.data.error, 'outside_geofence');

    const flat = await absen({ ...baseFields, token: await token() }, [face(0.3, 0), face(0.3, 0.01), face(0.3, 0)]);
    assert.equal(flat.data.error, 'liveness_failed');

    const mismatch = await absen({ ...baseFields, token: await token() }, [face(0.33, 0, 3), face(0.14, 0, 3), face(0.32, 0, 3)]);
    assert.equal(mismatch.data.error, 'face_mismatch');

    const patched = await request(server, {
      method: 'PATCH',
      path: `/api/admin/karyawan/${nisa.id}`,
      cookie: adminCookie,
      json: {
        name: nisa.name,
        phone: nisa.phone,
        businessId: nisa.businessId,
        shiftStart: null,
        graceMinutes: 0,
        locationIds: nisa.locationIds,
        active: true
      }
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.data));

    const clockIn = await absen({ ...baseFields, token: await token() }, [face(0.34, 0), face(0.14, 0.01), face(0.33, 0)]);
    assert.equal(clockIn.status, 200, JSON.stringify(clockIn.data));
    assert.equal(clockIn.data.absensi.lateMinutes, null);
    assert.equal(clockIn.data.absensi.locationId, toko.id);
    assert.equal(clockIn.data.absensi.inLiveness, 'kedip');
    assert.ok(clockIn.data.absensi.inFaceDistance < 0.05);

    const again = await absen({ ...baseFields, token: await token() }, [face(0.34, 0), face(0.14, 0), face(0.33, 0)]);
    assert.equal(again.data.error, 'already_in');
    queue.length = 0;

    const clockOut = await absen({
      ...baseFields,
      action: 'out',
      token: await token()
    }, [face(0.3, -0.2), face(0.3, 0), face(0.3, 0.15)]);
    assert.equal(clockOut.status, 200, JSON.stringify(clockOut.data));
    assert.equal(clockOut.data.absensi.outLiveness, 'geleng');
    assert.equal(typeof clockOut.data.absensi.hoursWorked, 'number');

    const closed = await absen({
      ...baseFields,
      action: 'out',
      token: await token()
    }, [face(0.34, 0), face(0.14, 0), face(0.33, 0)]);
    assert.equal(closed.data.error, 'not_clocked_in');

    const photo = await request(server, {
      path: `/api/foto/absensi/${clockIn.data.absensi.id}/masuk/0`,
      cookie: employeeCookie
    });
    assert.equal(photo.status, 200);
    assert.equal(photo.buf[0], 0xff);
    assert.equal(photo.buf[1], 0xd8);

    const andi = await request(server, {
      method: 'POST',
      path: '/api/karyawan/masuk',
      json: { phone: '081210000002', pin: '908172' }
    });
    const hidden = await request(server, {
      path: `/api/foto/absensi/${clockIn.data.absensi.id}/masuk`,
      cookie: cookiePair(andi.setCookie, 'hadir_karyawan')
    });
    assert.equal(hidden.status, 404);

    const exported = await request(server, {
      path: '/api/admin/ekspor.csv',
      cookie: adminCookie
    });
    assert.equal(exported.status, 200);
    assert.match(exported.buf.toString('utf8'), /Nisa Putri/);
    assert.match(exported.type, /csv/);

    const off = await request(server, {
      method: 'PATCH',
      path: `/api/admin/lokasi/${toko.id}`,
      cookie: adminCookie,
      json: { ...toko, active: false }
    });
    assert.equal(off.status, 200);
    const noPlace = await request(server, {
      path: `/api/karyawan/cek-lokasi?lat=${toko.latitude}&lng=${toko.longitude}&akurasi=10`,
      cookie: employeeCookie
    });
    assert.equal(noPlace.data.error, 'no_location');

    await request(server, {
      method: 'PATCH',
      path: `/api/admin/karyawan/${nisa.id}`,
      cookie: adminCookie,
      json: {
        name: nisa.name,
        phone: nisa.phone,
        businessId: nisa.businessId,
        shiftStart: '09:00',
        graceMinutes: 10,
        locationIds: nisa.locationIds,
        active: false
      }
    });
    const blocked = await request(server, {
      method: 'POST',
      path: '/api/karyawan/masuk',
      json: { phone: '081210000001', pin: '908172' }
    });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.data.error, 'inactive');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    app.locals.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
