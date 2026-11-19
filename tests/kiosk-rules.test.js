import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import jpeg from 'jpeg-js';
import { DatabaseSync } from 'node:sqlite';
import { identifyFace } from '../src/biometrics.js';
import { confirmedLabel, reduceKiosk } from '../src/kiosk.js';
import { migrateSqlite, postgresStatements } from '../src/migrate.js';
import { assertCooldown } from '../src/settings.js';
import { isTooFlat, measureSharpness } from '../src/sharpness.js';
import { arrivalFlag, jakartaDateLabel, rangeFromLabels, sumCompletedHours } from '../src/time.js';
import { faceRuntime } from '../src/face.js';
import { cookiePair, listen, multipart, request } from './http.js';
import { makeJpeg } from './jpeg.js';

const encoder = jpeg.default || jpeg;

function descriptor(shift = 0) {
  const values = Array.from({ length: 128 }, (_, index) => ((index % 5) - 2) / 20);
  values[0] += shift;
  return values;
}

function solidJpeg(width, value) {
  const data = Buffer.alloc(width * width * 4, value);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return Buffer.from(encoder.encode({ data, width, height: width }, 90).data);
}

test('mesin keadaan kios hanya mencatat setelah konfirmasi', () => {
  assert.equal(reduceKiosk('scanning', { type: 'clock_in', name: 'Nisa' }).phase, 'scanning');
  assert.equal(reduceKiosk('scanning', { type: 'match', name: 'Nisa' }).phase, 'confirming');
  assert.equal(reduceKiosk('confirming', { type: 'timeout' }).phase, 'scanning');
  const confirmed = reduceKiosk('confirming', { type: 'clock_in', name: 'Nisa Putri', time: '09:04' });
  assert.equal(confirmed.phase, 'confirmed');
  assert.equal(confirmed.action, 'in');
  assert.equal(confirmedLabel('in', 'Nisa Putri', '09:04'), 'Clock In Confirmed — Nisa Putri | 09:04');
  assert.equal(confirmedLabel('out', 'Nisa Putri', '17:10'), 'Clock Out Confirmed — Nisa Putri | 17:10');
  assert.equal(reduceKiosk('confirmed', { type: 'done' }).phase, 'scanning');
});

test('jeda, jam selesai, dan batas terlambat', () => {
  const awal = assertCooldown('2026-11-19T02:00:00.000Z', new Date('2026-11-19T02:00:20.000Z'), 30);
  assert.equal(awal.ok, false);
  assert.equal(awal.remaining, 10);
  assert.equal(assertCooldown('2026-11-19T02:00:00.000Z', new Date('2026-11-19T02:00:30.000Z'), 30).ok, true);
  assert.equal(sumCompletedHours([{ hoursWorked: 4 }, { hoursWorked: 3.5 }, { hoursWorked: null }]), 7.5);
  assert.equal(arrivalFlag('2026-11-19T02:30:00.000Z', { lateThreshold: '09:30:00', shiftStart: '09:00' }), 'tepat');
  assert.equal(arrivalFlag('2026-11-19T02:30:01.000Z', { lateThreshold: '09:30:00', shiftStart: '09:00' }), 'terlambat');
  assert.equal(arrivalFlag('2026-11-19T01:30:00.000Z', { lateThreshold: '09:30:00', shiftStart: '09:00' }), 'awal');
  const people = [{ id: 1, descriptors: [descriptor(0)] }];
  assert.equal(identifyFace(descriptor(0.4), people, 0.5).ok, true);
  assert.equal(identifyFace(descriptor(0.4), people, 0.3).error, 'face_unknown');
});

test('ketajaman menolak gambar datar dan migrasi menambah kolom', () => {
  const flat = measureSharpness(solidJpeg(220, 40));
  const noisy = measureSharpness(makeJpeg(3));
  assert.equal(isTooFlat(flat, 50), true);
  assert.equal(noisy.variance > 50, true);
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE attendance (id INTEGER PRIMARY KEY); CREATE TABLE face_samples (id INTEGER PRIMARY KEY);');
  migrateSqlite(db);
  const attendance = db.prepare('PRAGMA table_info(attendance)').all().map((row) => row.name);
  const samples = db.prepare('PRAGMA table_info(face_samples)').all().map((row) => row.name);
  assert.ok(attendance.includes('out_auto'));
  assert.ok(samples.includes('pose') && samples.includes('quality_score') && samples.includes('sharpness'));
  const postgres = postgresStatements().join('\n');
  assert.match(postgres, /app_settings/);
  assert.match(postgres, /out_auto/);
  assert.match(postgres, /quality_score/);
  db.close();
});

function face(ear, yaw, shift = 0, pitch = 0) {
  return { descriptor: descriptor(shift), ear, yaw, pitch, score: 0.9, box: { width: 180, height: 200 } };
}

test('server menerapkan ambang, jeda, impor, dan pulang otomatis', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hadir-kiosk-'));
  process.env.DATA_DIR = dir;
  process.env.NODE_ENV = 'test';
  process.env.COOKIE_SECURE = '0';
  process.env.DEMO = '1';
  process.env.DEMO_PIN = '908172';
  process.env.ADMIN_PHONE = '081299000001';
  process.env.ADMIN_PIN = '9081';
  process.env.FACE_MATCH_MAX_DISTANCE = '0.5';
  const queue = [];
  faceRuntime.detect = async () => {
    const next = queue.shift();
    assert.ok(next, 'deteksi tanpa antrean');
    return next;
  };
  const { createApp } = await import('../src/app.js');
  const { closeStaleSessions, getAttendance, insertClockIn, listEmployees } = await import('../src/repo.js');
  const app = await createApp();
  const server = await listen(app);
  try {
    const adminLogin = await request(server, {
      method: 'POST',
      path: '/api/admin/masuk',
      json: { phone: '081299000001', pin: '9081' }
    });
    const adminCookie = cookiePair(adminLogin.setCookie, 'hadir_admin');
    assert.equal(adminLogin.data.perluGantiSandi, false);
    const hari = jakartaDateLabel(new Date());
    const csv = `nama;telepon;tanggal;masuk;pulang\r\nNisa Putri;081210000001;${hari};09:40;17:00\r\nAndi Wijaya;081210000002;${hari};07:30;\r\n`;
    const imported = await request(server, {
      method: 'POST',
      path: '/api/admin/impor',
      cookie: adminCookie,
      form: multipart({}, [{ field: 'berkas', filename: 'lama.csv', buffer: Buffer.from(csv) }])
    });
    assert.equal(imported.status, 200, JSON.stringify(imported.data));
    assert.equal(imported.data.masuk, 2);
    const board = await request(server, { path: '/api/admin/hari-ini', cookie: adminCookie });
    const nisa = board.data.karyawan.find((orang) => orang.employee.name === 'Nisa Putri');
    const andi = board.data.karyawan.find((orang) => orang.employee.name === 'Andi Wijaya');
    assert.equal(nisa.flag, 'terlambat');
    assert.equal(andi.flag, 'awal');
    assert.equal(nisa.jam > 7 && nisa.jam < 8, true);
    assert.equal(andi.jam, 0);
    assert.equal(board.data.minggu.length, 7);

    const saved = await request(server, {
      method: 'PUT',
      path: '/api/admin/pengaturan',
      cookie: adminCookie,
      json: {
        faceDistanceThreshold: 0.3,
        frameSkip: 3,
        confirmationTimeoutSeconds: 10,
        detectionCooldownSeconds: 300,
        sharpnessMin: 50,
        autoClockOutTime: '20:00',
        lateThreshold: '09:30:00',
        maxEnrollmentFrames: 12,
        audioAnnouncements: true
      }
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.faceDistanceThreshold, 0.3);
    const kiosk = await request(server, { path: '/api/kiosk/pengaturan' });
    assert.equal(kiosk.data.frameSkip, 3);
    assert.equal(kiosk.data.confirmationTimeoutSeconds, 10);

    const karyawan = await request(server, { path: '/api/admin/karyawan', cookie: adminCookie });
    const sri = karyawan.data.karyawan.find((item) => item.name === 'Sri Rahayu');
    const rumah = karyawan.data.lokasi.find((item) => item.name.includes('Rumah'));
    queue.push(face(0.3, 0));
    const enrolled = await request(server, {
      method: 'POST',
      path: `/api/admin/karyawan/${sri.id}/wajah`,
      cookie: adminCookie,
      form: multipart({}, [{ field: 'foto', filename: 'depan.jpg', buffer: makeJpeg(20) }])
    });
    assert.equal(enrolled.status, 200, JSON.stringify(enrolled.data));

    const employeeLogin = await request(server, {
      method: 'POST',
      path: '/api/karyawan/masuk',
      json: { phone: '081210000003', pin: '908172' }
    });
    const employeeCookie = cookiePair(employeeLogin.setCookie, 'hadir_karyawan');
    async function token() {
      const response = await request(server, { method: 'POST', path: '/api/karyawan/tantangan', cookie: employeeCookie, json: {} });
      return response.data.token;
    }
    async function absen(shift) {
      queue.push(face(0.34, 0, shift), face(0.14, 0, shift), face(0.33, 0, shift));
      return request(server, {
        method: 'POST',
        path: '/api/karyawan/absen',
        cookie: employeeCookie,
        form: multipart({
          action: 'in',
          token: await token(),
          lat: String(rumah.latitude),
          lng: String(rumah.longitude),
          accuracy: '12'
        }, [1, 2, 3].map((seed) => ({ field: 'frame', filename: `${seed}.jpg`, buffer: makeJpeg(seed) })))
      });
    }
    const long = await absen(0.4);
    assert.equal(long.data.error, 'face_mismatch', JSON.stringify(long.data));
    const masuk = await absen(0);
    assert.equal(masuk.status, 200, JSON.stringify(masuk.data));
    const lagi = await absen(0);
    assert.equal(lagi.data.error, 'cooldown');

    const start = rangeFromLabels(hari, hari).start;
    const kemarin = new Date(start.getTime() - 15 * 60 * 60 * 1000).toISOString();
    const ids = listEmployees(app.locals.db);
    const nisaRow = ids.find((item) => item.name === 'Nisa Putri');
    const lokasi = nisaRow.locationIds[0];
    const terbuka = insertClockIn(app.locals.db, {
      employeeId: nisaRow.id,
      locationId: lokasi,
      clockInAt: kemarin,
      lat: 0,
      lng: 0,
      accuracy: 5,
      distanceMeters: 1,
      photo: 'impor',
      frames: [],
      faceDistance: 0,
      liveness: 'kedip',
      lateMinutes: 0
    });
    const closed = closeStaleSessions(app.locals.db, new Date(), '20:00');
    assert.equal(closed >= 1, true);
    const row = getAttendance(app.locals.db, terbuka);
    assert.equal(row.outAuto, true);
    assert.equal(row.outLiveness, 'auto');
    assert.equal(row.clockOutAt, new Date(start.getTime() - 4 * 60 * 60 * 1000).toISOString());
    assert.equal(getAttendance(app.locals.db, masuk.data.absensi.id).outAuto, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    app.locals.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
