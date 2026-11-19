import fs from 'node:fs';
import multer from 'multer';
import { BUSINESSES } from './demo-data.js';
import { assertNotLocked, clearLoginFailures, recordLoginFailure } from './lockout.js';
import { isWeakPassword } from './secrets.js';
import { parseCompanyName } from './settings.js';
import { assessEnrollment, assessLiveness, bestFaceDistance, evidenceFrameIndex } from './biometrics.js';
import { faceRuntime } from './face.js';
import { isTooFlat, measureSharpness } from './sharpness.js';
import { assertCooldown } from './settings.js';
import { normalizeImportRow, parseAttendanceTable } from './import-attendance.js';
import { matchGeofence } from './geo.js';
import { validateJpeg } from './images.js';
import { clientIp, hashToken, readCookies, sameOrigin, sendError, sendOk, tokenPair, wantsJson } from './http.js';
import { isValidPhone, isValidPin, normalizePhone } from './phone.js';
import { dummySecretHash, hashSecret, verifySecret } from './password.js';
import { removeUpload, resolveUpload, saveJpeg } from './photos.js';
import { rateLimit } from './rate-limit.js';
import { evaluateClock } from './rules.js';
import { EXPORT_HEADERS, toCsv, toSpreadsheetMl } from './csv.js';
import { arrivalFlag, formatDurasi, formatWibDate, formatWibTime, isDateLabel, defaultRange, jakartaMidnightUtc, wibDateTime } from './time.js';
import { shiftToMinutes } from './time.js';
import * as repo from './repo.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1_500_000, files: 40 }
});

function asyncRoute(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      if (error?.code === 'models_not_ready') return sendError(res, 'models_not_ready', 503);
      next(error);
    });
  };
}

function acceptFiles(field, max = 3) {
  const parse = upload.array(field, max);
  return (req, res, next) => {
    parse(req, res, (error) => {
      if (error) return sendError(res, 'bad_image');
      next();
    });
  };
}

function dbOf(req) {
  return req.app.locals.db;
}

function configOf(req) {
  return req.app.locals.config;
}

function guardWrite(req, res) {
  if (!wantsJson(req) || !sameOrigin(req)) {
    sendError(res, 'forbidden', 403);
    return false;
  }
  return true;
}

function sessionRow(req, kind) {
  const name = kind === 'admin' ? 'hadir_admin' : 'hadir_karyawan';
  const token = readCookies(req)[name];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = repo.getSession(dbOf(req), hashToken(token));
  if (!row || row.kind !== kind) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    repo.deleteSession(dbOf(req), row.token_hash);
    return null;
  }
  return row;
}

function setSessionCookie(res, config, kind, token) {
  const name = kind === 'admin' ? 'hadir_admin' : 'hadir_karyawan';
  const maxAge = kind === 'admin' ? 8 * 60 * 60 * 1000 : 14 * 60 * 60 * 1000;
  res.cookie(name, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge,
    path: '/'
  });
}

function clearSessionCookie(res, config, kind) {
  const name = kind === 'admin' ? 'hadir_admin' : 'hadir_karyawan';
  res.cookie(name, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: 0,
    path: '/'
  });
}

function requireAdmin(req, res) {
  const session = sessionRow(req, 'admin');
  if (!session) {
    sendError(res, 'unauthorized', 401);
    return null;
  }
  const admin = repo.getAdmin(dbOf(req), session.subject_id);
  if (!admin) {
    sendError(res, 'unauthorized', 401);
    return null;
  }
  const allowed = req.path === '/api/admin/sandi' || req.path === '/api/admin/keluar' || req.path === '/api/admin/saya' || req.path === '/api/usaha';
  if (admin.must_change_password === 1 && !allowed) {
    sendError(res, 'password_change_required', 403);
    return null;
  }
  return admin;
}

function recordPunch(req, res, { employee, action, frames, evidenceIndex, faceDistance, decision, now }) {
  const config = configOf(req);
  const paths = frames.map((frame) => saveJpeg(config, frame.buffer));
  try {
    if (action === 'in') {
      const id = repo.insertClockIn(dbOf(req), {
        employeeId: employee.id,
        locationId: decision.locationId,
        clockInAt: now.toISOString(),
        lat: Number(req.body.lat),
        lng: Number(req.body.lng),
        accuracy: Number(req.body.accuracy),
        distanceMeters: decision.distanceMeters,
        photo: paths[evidenceIndex],
        frames: paths,
        faceDistance,
        liveness: decision.method,
        lateMinutes: decision.lateMinutes
      });
      const terlambat = decision.lateMinutes > 0 ? ` Terlambat ${decision.lateMinutes} menit.` : '';
      sendOk(res, {
        pesan: `${employee.name} absen masuk.${terlambat}`,
        nama: employee.name,
        aksi: 'in',
        absensi: repo.getAttendance(dbOf(req), id)
      });
      return;
    }
    const open = repo.openAttendance(dbOf(req), employee.id);
    repo.completeClockOut(dbOf(req), open.id, {
      clockOutAt: now.toISOString(),
      locationId: decision.locationId,
      lat: Number(req.body.lat),
      lng: Number(req.body.lng),
      accuracy: Number(req.body.accuracy),
      distanceMeters: decision.distanceMeters,
      photo: paths[evidenceIndex],
      frames: paths,
      faceDistance,
      liveness: decision.method
    });
    const absensi = repo.getAttendance(dbOf(req), open.id);
    const durasi = formatDurasi(absensi.hoursWorked);
    sendOk(res, {
      pesan: durasi ? `${employee.name} absen pulang. ${durasi}.` : `${employee.name} absen pulang.`,
      nama: employee.name,
      aksi: 'out',
      absensi
    });
  } catch (error) {
    for (const relative of paths) removeUpload(config, relative);
    if (error.code === 'already_in' || error.code === 'not_clocked_in') {
      sendError(res, error.code);
      return;
    }
    throw error;
  }
}

function requireEmployee(req, res) {
  const session = sessionRow(req, 'employee');
  if (!session) {
    sendError(res, 'unauthorized', 401);
    return null;
  }
  const employee = repo.getEmployee(dbOf(req), session.subject_id);
  if (!employee || !employee.active) {
    repo.deleteSession(dbOf(req), session.token_hash);
    sendError(res, 'inactive', 403);
    return null;
  }
  return employee;
}

function cleanName(value) {
  const name = String(value || '').replace(/[\u0000-\u001f]/g, '').trim();
  if (name.length < 2 || name.length > 80) return null;
  return name;
}

function validBusiness(id) {
  return BUSINESSES.some((business) => business.id === id);
}

function parseShift(value) {
  if (value == null || value === '') return { ok: true, shiftStart: null };
  const shiftStart = String(value);
  if (shiftToMinutes(shiftStart) == null) return { ok: false };
  return { ok: true, shiftStart };
}

function resolveRange(query) {
  const fallback = defaultRange();
  const dari = query.dari ? (isDateLabel(query.dari) ? query.dari : null) : fallback.dari;
  const sampai = query.sampai ? (isDateLabel(query.sampai) ? query.sampai : null) : fallback.sampai;
  if (!dari || !sampai || dari > sampai) return null;
  const span = jakartaMidnightUtc(sampai) - jakartaMidnightUtc(dari);
  if (span > 366 * 24 * 60 * 60 * 1000) return null;
  return { dari, sampai };
}

function exportRows(records, employees = [], settings = {}) {
  const shifts = new Map(employees.map((employee) => [employee.id, employee.shiftStart]));
  return records.map((record) => [
    formatWibDate(record.clockInAt),
    record.employeeName,
    record.phone,
    record.businessName,
    record.locationName,
    formatWibTime(record.clockInAt),
    formatWibTime(record.clockOutAt),
    record.lateMinutes ?? '',
    record.hoursWorked ?? '',
    record.inAccuracy,
    record.inLat,
    record.inLng,
    record.inDistanceMeters,
    Number(record.inFaceDistance.toFixed(3)),
    record.outLocationName,
    record.outAccuracy ?? '',
    record.outLat ?? '',
    record.outLng ?? '',
    record.outFaceDistance == null ? '' : Number(record.outFaceDistance.toFixed(3)),
    record.outAuto ? 'ya' : '',
    arrivalFlag(record.clockInAt, { lateThreshold: settings.lateThreshold, shiftStart: shifts.get(record.employeeId) })
  ]);
}

function validateFrames(files) {
  if (!files || files.length !== 3) return { error: 'need_three_faces' };
  const hashes = new Set();
  for (const file of files) {
    const image = validateJpeg(file.buffer);
    if (!image.ok) return { error: image.error };
    if (hashes.has(image.hash)) return { error: 'duplicate_image' };
    hashes.add(image.hash);
  }
  return { ok: true };
}

function asList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (value == null || value === '') return [];
  return [String(value)];
}

async function readFaces(files, sharpnessMin = 0) {
  const checked = validateFrames(files);
  if (checked.error) return checked;
  const frames = [];
  for (const file of files) {
    const face = await faceRuntime.detect(file.buffer);
    if (face.error) return { error: face.error };
    const sharp = measureSharpness(file.buffer);
    if (isTooFlat(sharp, sharpnessMin)) return { error: 'photo_flat' };
    frames.push({ ...face, sharpness: sharp.variance, buffer: file.buffer });
  }
  return { frames };
}

async function readEnrollment(files, poses, sharpnessMin) {
  if (!files?.length || files.length !== poses.length) return { error: 'need_pose_set' };
  const hashes = new Set();
  const frames = [];
  for (let index = 0; index < files.length; index += 1) {
    const image = validateJpeg(files[index].buffer);
    if (!image.ok) return { error: image.error };
    if (hashes.has(image.hash)) return { error: 'duplicate_image' };
    hashes.add(image.hash);
    const face = await faceRuntime.detect(files[index].buffer);
    if (face.error) return { error: face.error };
    const sharp = measureSharpness(files[index].buffer);
    if (isTooFlat(sharp, sharpnessMin)) return { error: 'photo_flat' };
    frames.push({
      ...face,
      sharpness: sharp.variance,
      pose: poses[index],
      buffer: files[index].buffer
    });
  }
  return { frames };
}

export function registerRoutes(app) {
  app.get('/api/kesehatan', (req, res) => {
    sendOk(res, {
      waktu: new Date().toISOString(),
      zona: 'Asia/Jakarta',
      wajahSiap: faceRuntime.ready
    });
  });

  app.get('/api/usaha', (req, res) => {
    if (!requireAdmin(req, res)) return;
    sendOk(res, { usaha: BUSINESSES });
  });

  app.post('/api/karyawan/masuk', asyncRoute(async (req, res) => {
    if (!guardWrite(req, res)) return;
    const phone = normalizePhone(req.body?.phone);
    const pin = String(req.body?.pin || '');
    const key = `pin:${phone || clientIp(req)}`;
    if (!assertNotLocked(dbOf(req), key).ok || !rateLimit(key, { limit: 8, windowMs: 15 * 60 * 1000 })) {
      return sendError(res, 'locked', 429);
    }
    const row = isValidPhone(phone) ? repo.getEmployeeByPhone(dbOf(req), phone) : null;
    const matches = verifySecret(pin, row?.pin_hash || dummySecretHash());
    if (!row || !matches) {
      recordLoginFailure(dbOf(req), key);
      return sendError(res, 'bad_credentials', 401);
    }
    clearLoginFailures(dbOf(req), key);
    if (row.active !== 1) return sendError(res, 'inactive', 403);
    const { token, tokenHash } = tokenPair();
    const expires = new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString();
    repo.createSession(dbOf(req), { tokenHash, kind: 'employee', subjectId: row.id, expiresAt: expires });
    setSessionCookie(res, configOf(req), 'employee', token);
    sendOk(res, { karyawan: repo.getEmployee(dbOf(req), row.id) });
  }));

  app.post('/api/karyawan/keluar', (req, res) => {
    if (!guardWrite(req, res)) return;
    const session = sessionRow(req, 'employee');
    if (session) repo.deleteSession(dbOf(req), session.token_hash);
    clearSessionCookie(res, configOf(req), 'employee');
    sendOk(res);
  });

  app.get('/api/karyawan/saya', (req, res) => {
    const employee = requireEmployee(req, res);
    if (!employee) return;
    const db = dbOf(req);
    sendOk(res, {
      karyawan: employee,
      lokasi: repo.assignedLocations(db, employee.id),
      absenTerbuka: repo.openAttendance(db, employee.id)
    });
  });

  app.get('/api/karyawan/riwayat', (req, res) => {
    const employee = requireEmployee(req, res);
    if (!employee) return;
    sendOk(res, { absensi: repo.employeeHistory(dbOf(req), employee.id) });
  });

  app.get('/api/karyawan/cek-lokasi', (req, res) => {
    const employee = requireEmployee(req, res);
    if (!employee) return;
    const result = matchGeofence(
      { lat: req.query.lat, lng: req.query.lng, accuracy: req.query.akurasi },
      repo.assignedLocations(dbOf(req), employee.id),
      { maxAccuracyMeters: configOf(req).maxGpsAccuracy }
    );
    if (!result.ok) return sendError(res, result.error, 200, { accuracy: result.accuracy });
    sendOk(res, {
      lokasi: { id: result.locationId, nama: result.locationName },
      jarakMeter: result.distanceMeters,
      akurasi: result.accuracy
    });
  });

  app.post('/api/karyawan/tantangan', (req, res) => {
    if (!guardWrite(req, res)) return;
    const employee = requireEmployee(req, res);
    if (!employee) return;
    const { token, tokenHash } = tokenPair();
    const expires = new Date(Date.now() + 3 * 60 * 1000).toISOString();
    repo.createChallenge(dbOf(req), { tokenHash, employeeId: employee.id, expiresAt: expires });
    sendOk(res, { token, kedaluwarsa: expires });
  });

  app.post('/api/karyawan/absen', acceptFiles('frame'), asyncRoute(async (req, res) => {
    if (!guardWrite(req, res)) return;
    const employee = requireEmployee(req, res);
    if (!employee) return;
    if (!rateLimit(`absen:${employee.id}`, { limit: 12, windowMs: 10 * 60 * 1000 })) {
      return sendError(res, 'rate_limited', 429);
    }
    const token = String(req.body?.token || '');
    if (!/^[a-f0-9]{64}$/.test(token)) return sendError(res, 'challenge');
    const checked = validateFrames(req.files);
    if (checked.error) return sendError(res, checked.error === 'need_three_faces' ? 'liveness_failed' : checked.error);
    const samples = repo.faceSamples(dbOf(req), employee.id);
    if (samples.length < 2) return sendError(res, 'face_not_enrolled');
    const geofence = matchGeofence(
      { lat: req.body.lat, lng: req.body.lng, accuracy: req.body.accuracy },
      repo.assignedLocations(dbOf(req), employee.id),
      { maxAccuracyMeters: configOf(req).maxGpsAccuracy }
    );
    if (!geofence.ok) return sendError(res, geofence.error, 400, { akurasi: geofence.accuracy });
    const now = new Date();
    const settings = repo.getSettings(dbOf(req), configOf(req));
    const cooled = assertCooldown(repo.lastPunchAt(dbOf(req), employee.id), now, settings.detectionCooldownSeconds);
    if (!cooled.ok) return sendError(res, 'cooldown', 429, { detik: cooled.remaining });
    const consumed = repo.consumeChallenge(dbOf(req), hashToken(token), employee.id, now.toISOString());
    if (!consumed) return sendError(res, 'challenge');

    const read = await readFaces(req.files, settings.sharpnessMin);
    if (read.error) return sendError(res, read.error === 'need_three_faces' ? 'liveness_failed' : read.error);
    const liveness = assessLiveness(read.frames);
    const evidenceIndex = liveness.ok ? evidenceFrameIndex(read.frames, liveness.method) : 0;
    const faceDistance = bestFaceDistance(read.frames[evidenceIndex].descriptor, samples.map((sample) => sample.descriptor));
    const open = repo.openAttendance(dbOf(req), employee.id);
    const decision = evaluateClock({
      action: req.body.action,
      employeeActive: employee.active,
      faceSampleCount: samples.length,
      openAttendance: open,
      geofence,
      faceDistance,
      maxFaceDistance: settings.faceDistanceThreshold,
      liveness,
      shiftStart: employee.shiftStart,
      graceMinutes: employee.graceMinutes,
      now
    });
    if (!decision.ok) {
      return sendError(res, decision.error, 400, {
        jarakWajah: Number.isFinite(faceDistance) ? Math.round(faceDistance * 1000) / 1000 : undefined,
        akurasi: decision.accuracy
      });
    }

    recordPunch(req, res, {
      employee,
      action: req.body.action,
      frames: read.frames,
      evidenceIndex,
      faceDistance,
      decision,
      now
    });
  }));

  app.get('/api/karyawan/wajah-siap', (req, res) => {
    sendOk(res, { jumlah: repo.faceCatalog(dbOf(req)).length });
  });

  app.post('/api/karyawan/kenali', acceptFiles('frame'), asyncRoute(async (req, res) => {
    if (!guardWrite(req, res)) return;
    if (!rateLimit(`kenali:${clientIp(req)}`, { limit: 120, windowMs: 10 * 60 * 1000 })) {
      return sendError(res, 'rate_limited', 429);
    }
    const settings = repo.getSettings(dbOf(req), configOf(req));
    const bound = sessionRow(req, 'employee');
    let employee = bound ? repo.getEmployee(dbOf(req), bound.subject_id) : null;
    let issuedByPin = false;
    if (!employee) {
      const phone = normalizePhone(req.body?.phone);
      const pin = String(req.body?.pin || '');
      if (!phone || !pin) return sendError(res, 'perlu_faktor', 401);
      const lockKey = `pin:${phone}`;
      if (!assertNotLocked(dbOf(req), lockKey).ok) return sendError(res, 'locked', 429);
      const row = isValidPhone(phone) ? repo.getEmployeeByPhone(dbOf(req), phone) : null;
      const matches = verifySecret(pin, row?.pin_hash || dummySecretHash());
      if (!row || !matches) {
        recordLoginFailure(dbOf(req), lockKey);
        return sendError(res, 'bad_credentials', 401);
      }
      if (row.active !== 1) return sendError(res, 'inactive', 403);
      clearLoginFailures(dbOf(req), lockKey);
      employee = repo.getEmployee(dbOf(req), row.id);
      issuedByPin = true;
    }
    if (!employee?.active) return sendError(res, 'inactive', 403);
    const checked = validateFrames(req.files);
    if (checked.error) return sendError(res, checked.error === 'need_three_faces' ? 'liveness_failed' : checked.error);
    const samples = repo.faceSamples(dbOf(req), employee.id);
    if (samples.length < 2) return sendError(res, 'face_not_enrolled');
    const read = await readFaces(req.files, settings.sharpnessMin);
    if (read.error) return sendError(res, read.error === 'need_three_faces' ? 'liveness_failed' : read.error);
    const liveness = assessLiveness(read.frames);
    if (!liveness.ok) return sendError(res, liveness.error || 'liveness_failed');
    const evidenceIndex = evidenceFrameIndex(read.frames, liveness.method);
    const faceDistance = bestFaceDistance(read.frames[evidenceIndex].descriptor, samples.map((sample) => sample.descriptor));
    if (!Number.isFinite(faceDistance) || faceDistance > settings.faceDistanceThreshold) {
      return sendError(res, 'face_mismatch', 400, { nama: employee.name });
    }
    const now = new Date();
    const cooled = assertCooldown(repo.lastPunchAt(dbOf(req), employee.id), now, settings.detectionCooldownSeconds);
    if (!cooled.ok) return sendError(res, 'cooldown', 429, { detik: cooled.remaining, nama: employee.name });
    const geofence = matchGeofence(
      { lat: req.body.lat, lng: req.body.lng, accuracy: req.body.accuracy },
      repo.assignedLocations(dbOf(req), employee.id),
      { maxAccuracyMeters: configOf(req).maxGpsAccuracy }
    );
    if (!geofence.ok) return sendError(res, geofence.error, 400, { nama: employee.name, akurasi: geofence.accuracy });
    const open = repo.openAttendance(dbOf(req), employee.id);
    const { token, tokenHash } = tokenPair();
    const expires = new Date(Date.now() + 3 * 60 * 1000).toISOString();
    repo.createChallenge(dbOf(req), { tokenHash, employeeId: employee.id, expiresAt: expires });
    if (issuedByPin) {
      const session = tokenPair();
      repo.createSession(dbOf(req), {
        tokenHash: session.tokenHash,
        kind: 'employee',
        subjectId: employee.id,
        expiresAt: new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString()
      });
      setSessionCookie(res, configOf(req), 'employee', session.token);
    }
    sendOk(res, {
      nama: employee.name,
      karyawanId: employee.id,
      jarak: Math.round(faceDistance * 1000) / 1000,
      sesiTerbuka: Boolean(open),
      token,
      kedaluwarsa: expires
    });
  }));

  app.post('/api/admin/masuk', (req, res) => {
    if (!guardWrite(req, res)) return;
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const lockKey = `admin:${username || clientIp(req)}`;
    if (!assertNotLocked(dbOf(req), lockKey).ok || !rateLimit(lockKey, { limit: 8, windowMs: 15 * 60 * 1000 })) {
      return sendError(res, 'locked', 429);
    }
    const admin = repo.getAdminByUsername(dbOf(req), username);
    const matches = verifySecret(password, admin?.password_hash || dummySecretHash());
    if (!admin || !matches) {
      recordLoginFailure(dbOf(req), lockKey);
      return sendError(res, 'admin_bad_credentials', 401);
    }
    clearLoginFailures(dbOf(req), lockKey);
    const { token, tokenHash } = tokenPair();
    repo.createSession(dbOf(req), {
      tokenHash,
      kind: 'admin',
      subjectId: admin.id,
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
    });
    setSessionCookie(res, configOf(req), 'admin', token);
    sendOk(res, { namaPengguna: admin.username, perluGantiSandi: admin.must_change_password === 1 });
  });

  app.post('/api/admin/keluar', (req, res) => {
    if (!guardWrite(req, res)) return;
    const session = sessionRow(req, 'admin');
    if (session) repo.deleteSession(dbOf(req), session.token_hash);
    clearSessionCookie(res, configOf(req), 'admin');
    sendOk(res);
  });

  app.get('/api/admin/saya', (req, res) => {
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const config = configOf(req);
    const settings = repo.getSettings(dbOf(req), config);
    sendOk(res, {
      namaPengguna: admin.username,
      namaPerusahaan: settings.companyName,
      perluGantiSandi: admin.must_change_password === 1,
      jarakWajahMaks: settings.faceDistanceThreshold,
      akurasiGpsMaks: config.maxGpsAccuracy
    });
  });

  app.get('/api/kiosk/pengaturan', (req, res) => {
    const settings = repo.getSettings(dbOf(req), configOf(req));
    sendOk(res, {
      frameSkip: settings.frameSkip,
      confirmationTimeoutSeconds: settings.confirmationTimeoutSeconds,
      detectionCooldownSeconds: settings.detectionCooldownSeconds,
      sharpnessMin: settings.sharpnessMin,
      audioAnnouncements: settings.audioAnnouncements,
      lateThreshold: settings.lateThreshold,
      companyName: settings.companyName
    });
  });

  app.get('/api/admin/pengaturan', (req, res) => {
    if (!requireAdmin(req, res)) return;
    sendOk(res, repo.getSettings(dbOf(req), configOf(req)));
  });

  app.get('/manifest.webmanifest', (req, res) => {
    const name = repo.getSettings(dbOf(req), configOf(req)).companyName;
    res.type('application/manifest+json');
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      name: `${name} — Attendance`,
      short_name: name,
      description: 'Absen masuk dan pulang dengan swafoto serta lokasi.',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#ffffff',
      lang: 'id',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
      ]
    });
  });

  app.put('/api/admin/pengaturan', (req, res) => {
    if (!guardWrite(req, res)) return;
    if (!requireAdmin(req, res)) return;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'companyName')) {
      const parsed = parseCompanyName(req.body.companyName);
      if (!parsed.ok) return sendError(res, 'bad_request');
    }
    const settings = repo.saveSettings(dbOf(req), req.body || {}, configOf(req));
    sendOk(res, { ...settings, pesan: 'Pengaturan disimpan.' });
  });

  app.post('/api/admin/sandi', (req, res) => {
    if (!guardWrite(req, res)) return;
    const admin = requireAdmin(req, res);
    if (!admin) return;
    const password = String(req.body?.password || '');
    if (password.length < 8 || isWeakPassword(password) || verifySecret(password, admin.password_hash)) {
      return sendError(res, 'password_weak');
    }
    repo.updateAdminPassword(dbOf(req), admin.id, hashSecret(password));
    sendOk(res, { pesan: 'Kata sandi admin diperbarui.' });
  });

  app.get('/api/admin/hari-ini', (req, res) => {
    if (!requireAdmin(req, res)) return;
    sendOk(res, repo.todayBoard(dbOf(req), new Date(), configOf(req)));
  });

  app.get('/api/admin/karyawan', (req, res) => {
    if (!requireAdmin(req, res)) return;
    sendOk(res, { karyawan: repo.listEmployees(dbOf(req)), lokasi: repo.listLocations(dbOf(req)) });
  });

  app.post('/api/admin/karyawan', (req, res) => {
    if (!guardWrite(req, res)) return;
    if (!requireAdmin(req, res)) return;
    const saved = saveEmployeeFromBody(req, null);
    if (saved.error) return sendError(res, saved.error, saved.status || 400);
    sendOk(res, { karyawan: repo.getEmployee(dbOf(req), saved.id), pesan: 'Karyawan ditambahkan.' });
  });

  app.patch('/api/admin/karyawan/:id', (req, res) => {
    if (!guardWrite(req, res)) return;
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!repo.getEmployee(dbOf(req), id)) return sendError(res, 'not_found', 404);
    const saved = saveEmployeeFromBody(req, id);
    if (saved.error) return sendError(res, saved.error, saved.status || 400);
    sendOk(res, { karyawan: repo.getEmployee(dbOf(req), id), pesan: 'Data karyawan disimpan.' });
  });

  app.get('/api/admin/karyawan/:id/wajah', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const employee = repo.getEmployee(dbOf(req), Number(req.params.id));
    if (!employee) return sendError(res, 'not_found', 404);
    const samples = repo.faceSamples(dbOf(req), employee.id).map((sample) => ({
      id: sample.id,
      dibuat: sample.createdAt
    }));
    sendOk(res, { sampel: samples });
  });

  app.post('/api/admin/karyawan/:id/wajah', acceptFiles('foto', 40), asyncRoute(async (req, res) => {
    if (!guardWrite(req, res)) return;
    if (!requireAdmin(req, res)) return;
    const employee = repo.getEmployee(dbOf(req), Number(req.params.id));
    if (!employee) return sendError(res, 'not_found', 404);
    const settings = repo.getSettings(dbOf(req), configOf(req));
    const read = await readEnrollment(req.files, asList(req.body?.pose), settings.sharpnessMin);
    if (read.error) return sendError(res, read.error);
    const enrollment = assessEnrollment(read.frames, { maxFrames: settings.maxEnrollmentFrames });
    if (!enrollment.ok) return sendError(res, enrollment.error);
    const config = configOf(req);
    const paths = read.frames.map((frame) => saveJpeg(config, frame.buffer));
    try {
      const replaced = repo.replaceFaceSamples(dbOf(req), employee.id, read.frames.map((frame, index) => ({
        descriptor: frame.descriptor,
        imagePath: paths[index],
        pose: frame.pose,
        score: frame.score,
        sharpness: frame.sharpness,
        yaw: frame.yaw,
        pitch: frame.pitch
      })));
      for (const relative of replaced.oldPaths) removeUpload(config, relative);
    } catch (error) {
      for (const relative of paths) removeUpload(config, relative);
      throw error;
    }
    sendOk(res, { pesan: 'Wajah karyawan tersimpan. Contoh wajah diperbarui.', karyawan: repo.getEmployee(dbOf(req), employee.id) });
  }));

  app.delete('/api/admin/karyawan/:id/wajah/:sampleId', (req, res) => {
    if (!guardWrite(req, res)) return;
    if (!requireAdmin(req, res)) return;
    const relative = repo.deleteFaceSample(dbOf(req), Number(req.params.id), Number(req.params.sampleId));
    if (!relative) return sendError(res, 'not_found', 404);
    removeUpload(configOf(req), relative);
    sendOk(res, { pesan: 'Sampel wajah dihapus.', karyawan: repo.getEmployee(dbOf(req), Number(req.params.id)) });
  });

  app.get('/api/admin/wajah/:id/foto', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const row = dbOf(req).prepare('SELECT image_path FROM face_samples WHERE id = ?').get(Number(req.params.id));
    if (!row) return sendError(res, 'not_found', 404);
    const full = resolveUpload(configOf(req), row.image_path);
    if (!full) return sendError(res, 'not_found', 404);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(full);
  });

  app.get('/api/admin/lokasi', (req, res) => {
    if (!requireAdmin(req, res)) return;
    sendOk(res, { lokasi: repo.listLocations(dbOf(req)) });
  });

  app.post('/api/admin/lokasi', (req, res) => {
    if (!guardWrite(req, res)) return;
    if (!requireAdmin(req, res)) return;
    const input = locationFromBody(req.body);
    if (input.error) return sendError(res, input.error);
    const id = repo.saveLocation(dbOf(req), input);
    sendOk(res, { lokasi: repo.getLocation(dbOf(req), id), pesan: 'Lokasi disimpan.' });
  });

  app.patch('/api/admin/lokasi/:id', (req, res) => {
    if (!guardWrite(req, res)) return;
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!repo.getLocation(dbOf(req), id)) return sendError(res, 'not_found', 404);
    const input = locationFromBody(req.body);
    if (input.error) return sendError(res, input.error);
    repo.saveLocation(dbOf(req), { ...input, id });
    sendOk(res, { lokasi: repo.getLocation(dbOf(req), id), pesan: 'Lokasi diperbarui.' });
  });

  app.delete('/api/admin/lokasi/:id', (req, res) => {
    if (!guardWrite(req, res)) return;
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id);
    if (!repo.getLocation(dbOf(req), id)) return sendError(res, 'not_found', 404);
    if (repo.locationUsage(dbOf(req), id) > 0) return sendError(res, 'location_in_use');
    repo.deleteLocation(dbOf(req), id);
    sendOk(res, { pesan: 'Lokasi dihapus.' });
  });

  app.post('/api/admin/absensi/:id/tutup', (req, res) => {
    if (!guardWrite(req, res)) return;
    if (!requireAdmin(req, res)) return;
    const existing = repo.getAttendance(dbOf(req), Number(req.params.id));
    if (!existing) return sendError(res, 'not_found', 404);
    const mentah = String(req.body?.clockOutAt || '');
    const cocok = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(mentah);
    const clockOutAt = cocok ? wibDateTime(cocok[1], cocok[2]) : (mentah ? new Date(mentah).toISOString() : new Date().toISOString());
    const saved = repo.correctSession(dbOf(req), existing.id, clockOutAt);
    if (saved.error) return sendError(res, saved.error, saved.error === 'not_found' ? 404 : 400);
    sendOk(res, { absensi: saved.attendance, pesan: 'Sesi ditutup.' });
  });

  app.post('/api/admin/impor', acceptFiles('berkas', 1), (req, res) => {
    if (!guardWrite(req, res)) return;
    if (!requireAdmin(req, res)) return;
    const file = req.files?.[0];
    if (!file) return sendError(res, 'import_failed');
    const table = parseAttendanceTable(file.buffer);
    if (!table.length) return sendError(res, 'import_empty');
    const hasil = repo.importSessions(dbOf(req), table.map((row) => normalizeImportRow(row)));
    sendOk(res, { ...hasil, pesan: `${hasil.masuk} baris absensi diimpor.` });
  });

  app.get('/api/admin/absensi', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const range = resolveRange(req.query);
    if (!range) return sendError(res, 'bad_request');
    sendOk(res, {
      ...range,
      absensi: repo.listAttendance(dbOf(req), {
        ...range,
        employeeId: numberOrNull(req.query.karyawanId),
        locationId: numberOrNull(req.query.lokasiId)
      })
    });
  });

  app.get('/api/admin/rekap', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const range = resolveRange(req.query);
    if (!range) return sendError(res, 'bad_request');
    sendOk(res, { ...range, rekap: repo.recap(dbOf(req), range) });
  });

  app.get('/api/admin/ekspor.csv', (req, res) => {
    sendExport(req, res, 'csv');
  });

  app.get('/api/admin/ekspor.xls', (req, res) => {
    sendExport(req, res, 'xls');
  });

  app.get('/api/foto/absensi/:id/:phase/:index?', (req, res) => {
    const employeeSession = sessionRow(req, 'employee');
    const adminSession = sessionRow(req, 'admin');
    if (!employeeSession && !adminSession) return sendError(res, 'unauthorized', 401);
    const phase = req.params.phase === 'masuk' || req.params.phase === 'pulang' ? req.params.phase : null;
    if (!phase) return sendError(res, 'not_found', 404);
    const photo = repo.attendancePhoto(dbOf(req), Number(req.params.id), phase);
    if (!photo) return sendError(res, 'not_found', 404);
    if (employeeSession && !adminSession && photo.employeeId !== employeeSession.subject_id) {
      return sendError(res, 'not_found', 404);
    }
    const index = req.params.index == null ? null : Number(req.params.index);
    const relative = index == null ? photo.primary : photo.frames[index];
    const full = resolveUpload(configOf(req), relative);
    if (!full) return sendError(res, 'not_found', 404);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(full).pipe(res);
  });
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function saveEmployeeFromBody(req, id) {
  const body = req.body || {};
  const name = cleanName(body.name);
  const phone = normalizePhone(body.phone);
  const businessId = body.businessId;
  const shift = parseShift(body.shiftStart);
  const grace = Number(body.graceMinutes ?? 0);
  const locationIds = Array.isArray(body.locationIds) ? [...new Set(body.locationIds.map(Number))] : [];
  const pin = body.pin == null || body.pin === '' ? '' : String(body.pin);
  if (!name || !isValidPhone(phone) || !validBusiness(businessId) || !shift.ok) return { error: 'bad_request' };
  if (!Number.isInteger(grace) || grace < 0 || grace > 180) return { error: 'bad_request' };
  if (!id && !isValidPin(pin)) return { error: 'pin_invalid' };
  if (pin && !isValidPin(pin)) return { error: 'pin_invalid' };
  if (!locationIds.length || locationIds.some((locationId) => !repo.getLocation(dbOf(req), locationId))) {
    return { error: 'bad_request' };
  }
  const existing = repo.getEmployeeByPhone(dbOf(req), phone);
  if (existing && existing.id !== id) return { error: 'phone_taken', status: 409 };
  const savedId = repo.saveEmployee(dbOf(req), {
    id,
    name,
    phone,
    businessId,
    shiftStart: shift.shiftStart,
    graceMinutes: grace,
    active: body.active !== false && body.active !== 0 && body.active !== '0',
    locationIds
  }, pin ? hashSecret(pin) : null);
  return { id: savedId };
}

function locationFromBody(body) {
  const name = cleanName(body?.name);
  const businessId = body?.businessId;
  const latitude = Number(body?.latitude);
  const longitude = Number(body?.longitude);
  const radiusMeters = Number(body?.radiusMeters);
  if (!name || !validBusiness(businessId)) return { error: 'bad_request' };
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return { error: 'bad_request' };
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return { error: 'bad_request' };
  if (!Number.isFinite(radiusMeters) || radiusMeters < 30 || radiusMeters > 2000) return { error: 'bad_request' };
  return {
    name,
    businessId,
    latitude,
    longitude,
    radiusMeters,
    active: body.active !== false && body.active !== 0 && body.active !== '0'
  };
}

function sendExport(req, res, kind) {
  if (!requireAdmin(req, res)) return;
  const range = resolveRange(req.query);
  if (!range) return sendError(res, 'bad_request');
  const records = repo.listAttendance(dbOf(req), {
    ...range,
    employeeId: numberOrNull(req.query.karyawanId),
    locationId: numberOrNull(req.query.lokasiId),
    limit: 10000
  });
  const rows = exportRows(records, repo.listEmployees(dbOf(req)), repo.getSettings(dbOf(req), configOf(req)));
  const filename = `absensi-${range.dari}-${range.sampai}`;
  if (kind === 'xls') {
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xls"`);
    res.send(toSpreadsheetMl(EXPORT_HEADERS, rows));
    return;
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.send(toCsv(EXPORT_HEADERS, rows));
}
