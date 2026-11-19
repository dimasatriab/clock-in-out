import { BUSINESSES, DEMO_EMPLOYEES, DEMO_LOCATIONS } from './demo-data.js';
import { hashSecret } from './password.js';
import { normalizePhone } from './phone.js';
import { transaction } from './db.js';
import { settingsFromRows, serializeSettings } from './settings.js';
import { arrivalFlag, jakartaDateLabel, jakartaDayRange, rangeFromLabels, staleClockOutIso, sumCompletedHours, workedHours } from './time.js';

export function seedIfEmpty(db, config) {
  const insertBusiness = db.prepare('INSERT OR IGNORE INTO businesses (id, name) VALUES (?, ?)');
  for (const business of BUSINESSES) insertBusiness.run(business.id, business.name);
  ensureEverywhereLocation(db);

  const adminCount = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
  const now = new Date().toISOString();
  if (adminCount === 0 && config.adminPhone && config.adminPin) {
    db.prepare('INSERT INTO admins (phone, pin_hash, must_change_password, created_at) VALUES (?, ?, 0, ?)').run(
      config.adminPhone,
      hashSecret(config.adminPin),
      now
    );
  }
  if (!config.demo || !/^\d{4,6}$/.test(config.demoPin || '')) {
    ensureAdminEmployee(db, config);
    return { seeded: adminCount === 0 };
  }
  const employeeCount = db.prepare('SELECT COUNT(*) AS n FROM employees').get().n;
  if (employeeCount > 0) {
    ensureAdminEmployee(db, config);
    return { seeded: false };
  }

  const insertLocation = db.prepare(`
    INSERT INTO locations (business_id, name, latitude, longitude, radius_meters, active, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `);
  const locationIds = new Map();
  for (const location of DEMO_LOCATIONS) {
    const result = insertLocation.run(
      location.businessId,
      location.name,
      location.latitude,
      location.longitude,
      location.radiusMeters,
      now
    );
    locationIds.set(location.name, Number(result.lastInsertRowid));
  }

  const insertEmployee = db.prepare(`
    INSERT INTO employees (name, phone, pin_hash, business_id, shift_start, grace_minutes, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `);
  const link = db.prepare('INSERT INTO employee_locations (employee_id, location_id) VALUES (?, ?)');
  for (const employee of DEMO_EMPLOYEES) {
    const result = insertEmployee.run(
      employee.name,
      employee.phone,
      hashSecret(config.demoPin),
      employee.businessId,
      employee.shiftStart,
      employee.graceMinutes,
      now
    );
    link.run(Number(result.lastInsertRowid), locationIds.get(employee.locationName));
  }
  ensureAdminEmployee(db, config);
  return { seeded: true };
}

export function ensureAdminEmployee(db, config) {
  if (!config.adminPhone) return null;
  const admin = getAdminByPhone(db, config.adminPhone);
  if (!admin) return null;
  const existing = db.prepare('SELECT id, pin_hash FROM employees WHERE phone = ?').get(config.adminPhone);
  if (existing) {
    if (existing.pin_hash !== admin.pin_hash) {
      db.prepare('UPDATE employees SET pin_hash = ? WHERE id = ?').run(admin.pin_hash, existing.id);
    }
    return existing.id;
  }
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO employees (name, phone, pin_hash, business_id, shift_start, grace_minutes, active, created_at)
    VALUES ('Admin', ?, ?, 'toko', NULL, 0, 1, ?)
  `).run(config.adminPhone, admin.pin_hash, now);
  const id = Number(result.lastInsertRowid);
  const locations = db.prepare('SELECT id FROM locations WHERE active = 1').all();
  const link = db.prepare('INSERT OR IGNORE INTO employee_locations (employee_id, location_id) VALUES (?, ?)');
  for (const location of locations) link.run(id, location.id);
  return id;
}

export function businessName(id) {
  return BUSINESSES.find((business) => business.id === id)?.name || id;
}

function mapLocation(row) {
  if (!row) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    businessName: businessName(row.business_id),
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    radiusMeters: row.radius_meters,
    active: row.active === 1,
    scope: row.scope || 'place'
  };
}

function mapEmployee(row, locationIds = []) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    businessId: row.business_id,
    businessName: businessName(row.business_id),
    shiftStart: row.shift_start,
    graceMinutes: row.grace_minutes,
    active: row.active === 1,
    everywhere: row.everywhere === 1,
    locationIds,
    faceSampleCount: row.face_sample_count ?? 0
  };
}

export function getAdminByPhone(db, phone) {
  return db.prepare('SELECT * FROM admins WHERE phone = ?').get(phone);
}

export function getAdmin(db, id) {
  return db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
}

export function updateAdminPin(db, id, pinHash) {
  const admin = getAdmin(db, id);
  db.prepare('UPDATE admins SET pin_hash = ?, must_change_password = 0 WHERE id = ?').run(pinHash, id);
  if (admin?.phone) {
    db.prepare('UPDATE employees SET pin_hash = ? WHERE phone = ?').run(pinHash, admin.phone);
  }
}

export function getEmployeeByPhone(db, phone) {
  return db.prepare('SELECT * FROM employees WHERE phone = ?').get(phone);
}

export function getEmployee(db, id) {
  const row = db.prepare(`
    SELECT e.*, (SELECT COUNT(*) FROM face_samples f WHERE f.employee_id = e.id) AS face_sample_count
    FROM employees e WHERE e.id = ?
  `).get(id);
  if (!row) return null;
  const locationIds = db.prepare(`
    SELECT el.location_id FROM employee_locations el
    JOIN locations l ON l.id = el.location_id
    WHERE el.employee_id = ? AND l.scope = 'place' AND l.deleted_at IS NULL
  `).all(id).map((item) => item.location_id);
  return mapEmployee(row, locationIds);
}

export function listEmployees(db) {
  const rows = db.prepare(`
    SELECT e.*, (SELECT COUNT(*) FROM face_samples f WHERE f.employee_id = e.id) AS face_sample_count
    FROM employees e
    WHERE e.deleted_at IS NULL
    ORDER BY e.active DESC, e.name
  `).all();
  const links = db.prepare(`
    SELECT el.employee_id, el.location_id FROM employee_locations el
    JOIN locations l ON l.id = el.location_id
    WHERE l.scope = 'place' AND l.deleted_at IS NULL
  `).all();
  return rows.map((row) => mapEmployee(row, links.filter((link) => link.employee_id === row.id).map((link) => link.location_id)));
}

export function saveEmployee(db, input, pinHash) {
  const now = new Date().toISOString();
  return transaction(db, () => {
    let id = input.id;
    if (id) {
      if (pinHash) {
        db.prepare(`
          UPDATE employees
          SET name = ?, phone = ?, pin_hash = ?, business_id = ?, shift_start = ?, grace_minutes = ?, active = ?, everywhere = ?
          WHERE id = ?
        `).run(input.name, input.phone, pinHash, input.businessId, input.shiftStart, input.graceMinutes, input.active ? 1 : 0, input.everywhere ? 1 : 0, id);
      } else {
        db.prepare(`
          UPDATE employees
          SET name = ?, phone = ?, business_id = ?, shift_start = ?, grace_minutes = ?, active = ?, everywhere = ?
          WHERE id = ?
        `).run(input.name, input.phone, input.businessId, input.shiftStart, input.graceMinutes, input.active ? 1 : 0, input.everywhere ? 1 : 0, id);
      }
      db.prepare('DELETE FROM employee_locations WHERE employee_id = ?').run(id);
    } else {
      const result = db.prepare(`
        INSERT INTO employees (name, phone, pin_hash, business_id, shift_start, grace_minutes, active, everywhere, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(input.name, input.phone, pinHash, input.businessId, input.shiftStart, input.graceMinutes, input.active ? 1 : 0, input.everywhere ? 1 : 0, now);
      id = Number(result.lastInsertRowid);
    }
    const link = db.prepare('INSERT INTO employee_locations (employee_id, location_id) VALUES (?, ?)');
    for (const locationId of input.locationIds) link.run(id, locationId);
    return id;
  });
}

export function listLocations(db, { activeOnly = false } = {}) {
  const sql = activeOnly
    ? "SELECT * FROM locations WHERE active = 1 AND scope = 'place' AND deleted_at IS NULL ORDER BY name"
    : "SELECT * FROM locations WHERE scope = 'place' AND deleted_at IS NULL ORDER BY active DESC, name";
  return db.prepare(sql).all().map(mapLocation);
}

export function ensureEverywhereLocation(db) {
  const existing = db.prepare("SELECT id FROM locations WHERE scope = 'everywhere'").get();
  if (existing) return existing.id;
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO locations (business_id, name, latitude, longitude, radius_meters, active, scope, created_at)
    VALUES ('toko', 'Everywhere', 0, 0, 0, 1, 'everywhere', ?)
  `).run(now);
  return Number(result.lastInsertRowid);
}

export function getEverywhereLocation(db) {
  return mapLocation(db.prepare("SELECT * FROM locations WHERE scope = 'everywhere' LIMIT 1").get());
}

export function assignedLocations(db, employeeId) {
  return db.prepare(`
    SELECT l.* FROM locations l
    JOIN employee_locations el ON el.location_id = l.id
    WHERE el.employee_id = ? AND l.active = 1 AND l.scope = 'place' AND l.deleted_at IS NULL
  `).all(employeeId).map(mapLocation);
}

export function getLocation(db, id) {
  return mapLocation(db.prepare('SELECT * FROM locations WHERE id = ?').get(id));
}

export function saveLocation(db, input) {
  const now = new Date().toISOString();
  if (input.id) {
    db.prepare(`
      UPDATE locations
      SET business_id = ?, name = ?, latitude = ?, longitude = ?, radius_meters = ?, active = ?
      WHERE id = ?
    `).run(input.businessId, input.name, input.latitude, input.longitude, input.radiusMeters, input.active ? 1 : 0, input.id);
    return input.id;
  }
  const result = db.prepare(`
    INSERT INTO locations (business_id, name, latitude, longitude, radius_meters, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(input.businessId, input.name, input.latitude, input.longitude, input.radiusMeters, input.active ? 1 : 0, now);
  return Number(result.lastInsertRowid);
}

export function locationUsage(db, id) {
  return db.prepare('SELECT COUNT(*) AS n FROM attendance WHERE location_id = ? OR out_location_id = ?').get(id, id).n;
}

export function employeesLeftWithoutPlace(db, locationId) {
  return db.prepare(`
    SELECT e.name FROM employees e
    JOIN employee_locations el ON el.employee_id = e.id AND el.location_id = ?
    WHERE e.deleted_at IS NULL AND e.everywhere = 0
      AND NOT EXISTS (
        SELECT 1 FROM employee_locations other
        JOIN locations l ON l.id = other.location_id
        WHERE other.employee_id = e.id
          AND other.location_id != ?
          AND l.deleted_at IS NULL
          AND l.scope = 'place'
      )
    ORDER BY e.name
  `).all(locationId, locationId).map((row) => row.name);
}

export function deleteLocation(db, id) {
  const row = db.prepare('SELECT scope, deleted_at FROM locations WHERE id = ?').get(id);
  if (!row || row.scope === 'everywhere' || row.deleted_at) return false;
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('DELETE FROM employee_locations WHERE location_id = ?').run(id);
    db.prepare('UPDATE locations SET active = 0, deleted_at = ? WHERE id = ?').run(now, id);
  });
  return true;
}

export function deleteEmployee(db, id) {
  const row = db.prepare('SELECT id, deleted_at FROM employees WHERE id = ?').get(id);
  if (!row || row.deleted_at) return null;
  const photos = db.prepare('SELECT image_path FROM face_samples WHERE employee_id = ?').all(id).map((item) => item.image_path);
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('DELETE FROM face_samples WHERE employee_id = ?').run(id);
    db.prepare("DELETE FROM sessions WHERE kind = 'employee' AND subject_id = ?").run(id);
    db.prepare('UPDATE employees SET active = 0, deleted_at = ? WHERE id = ?').run(now, id);
  });
  return { photos };
}

const catalogCache = new WeakMap();

export function faceCatalog(db) {
  const stamp = db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS m FROM face_samples').get();
  const key = `${stamp.n}:${stamp.m}`;
  const cached = catalogCache.get(db);
  if (cached?.key === key) return cached.catalog;
  const rows = db.prepare(`
    SELECT e.id AS employee_id, f.descriptor
    FROM employees e
    JOIN face_samples f ON f.employee_id = e.id
    WHERE e.active = 1
    ORDER BY e.id, f.id
  `).all();
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.employee_id)) grouped.set(row.employee_id, []);
    grouped.get(row.employee_id).push(JSON.parse(row.descriptor));
  }
  const catalog = [...grouped.entries()]
    .filter(([, descriptors]) => descriptors.length >= 1)
    .map(([id, descriptors]) => ({ id, descriptors }));
  catalogCache.set(db, { key, catalog });
  return catalog;
}

export function faceSamples(db, employeeId) {
  return db.prepare('SELECT * FROM face_samples WHERE employee_id = ? ORDER BY id').all(employeeId).map((row) => ({
    id: row.id,
    employeeId: row.employee_id,
    descriptor: JSON.parse(row.descriptor),
    imagePath: row.image_path,
    pose: row.pose || '',
    qualityScore: row.quality_score,
    sharpness: row.sharpness,
    yaw: row.yaw,
    pitch: row.pitch,
    createdAt: row.created_at
  }));
}

export function addFaceSamples(db, employeeId, samples) {
  const now = new Date().toISOString();
  const insert = db.prepare(`INSERT INTO face_samples (
    employee_id, descriptor, image_path, pose, quality_score, sharpness, yaw, pitch, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  return transaction(db, () => samples.map((sample) => Number(insert.run(
    employeeId,
    JSON.stringify(sample.descriptor),
    sample.imagePath,
    sample.pose || null,
    sample.qualityScore ?? sample.score ?? null,
    sample.sharpness ?? null,
    sample.yaw ?? null,
    sample.pitch ?? null,
    now
  ).lastInsertRowid)));
}

export function replaceFaceSamples(db, employeeId, samples) {
  return transaction(db, () => {
    const old = db.prepare('SELECT image_path FROM face_samples WHERE employee_id = ?').all(employeeId).map((row) => row.image_path);
    db.prepare('DELETE FROM face_samples WHERE employee_id = ?').run(employeeId);
    const now = new Date().toISOString();
    const insert = db.prepare(`INSERT INTO face_samples (
      employee_id, descriptor, image_path, pose, quality_score, sharpness, yaw, pitch, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const ids = samples.map((sample) => Number(insert.run(
      employeeId,
      JSON.stringify(sample.descriptor),
      sample.imagePath,
      sample.pose || null,
      sample.qualityScore ?? sample.score ?? null,
      sample.sharpness ?? null,
      sample.yaw ?? null,
      sample.pitch ?? null,
      now
    ).lastInsertRowid));
    return { ids, oldPaths: old };
  });
}

export function deleteFaceSample(db, employeeId, sampleId) {
  const row = db.prepare('SELECT * FROM face_samples WHERE id = ? AND employee_id = ?').get(sampleId, employeeId);
  if (!row) return null;
  db.prepare('DELETE FROM face_samples WHERE id = ?').run(sampleId);
  return row.image_path;
}

export function openAttendance(db, employeeId) {
  const row = db.prepare('SELECT * FROM attendance WHERE employee_id = ? AND clock_out_at IS NULL ORDER BY clock_in_at DESC LIMIT 1').get(employeeId);
  return row ? mapAttendance(db, row) : null;
}

export function insertClockIn(db, row) {
  return transaction(db, () => {
    const open = db.prepare('SELECT id FROM attendance WHERE employee_id = ? AND clock_out_at IS NULL').get(row.employeeId);
    if (open) {
      const error = new Error('already_in');
      error.code = 'already_in';
      throw error;
    }
    const result = db.prepare(`
      INSERT INTO attendance (
        employee_id, location_id, clock_in_at, in_lat, in_lng, in_accuracy, in_distance_meters,
        in_photo, in_frames, in_face_distance, in_liveness, late_minutes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.employeeId,
      row.locationId,
      row.clockInAt,
      row.lat,
      row.lng,
      row.accuracy,
      row.distanceMeters,
      row.photo,
      JSON.stringify(row.frames),
      row.faceDistance,
      row.liveness,
      row.lateMinutes,
      row.clockInAt
    );
    return Number(result.lastInsertRowid);
  });
}

export function completeClockOut(db, attendanceId, row) {
  return transaction(db, () => {
    const current = db.prepare('SELECT id, clock_out_at FROM attendance WHERE id = ?').get(attendanceId);
    if (!current || current.clock_out_at) {
      const error = new Error('not_clocked_in');
      error.code = 'not_clocked_in';
      throw error;
    }
    db.prepare(`
      UPDATE attendance SET
        clock_out_at = ?, out_location_id = ?, out_lat = ?, out_lng = ?, out_accuracy = ?,
        out_distance_meters = ?, out_photo = ?, out_frames = ?, out_face_distance = ?, out_liveness = ?,
        out_auto = 0
      WHERE id = ?
    `).run(
      row.clockOutAt,
      row.locationId,
      row.lat,
      row.lng,
      row.accuracy,
      row.distanceMeters,
      row.photo,
      JSON.stringify(row.frames),
      row.faceDistance,
      row.liveness,
      attendanceId
    );
  });
}

function mapAttendance(db, row) {
  const employee = db.prepare('SELECT name, phone, business_id, deleted_at FROM employees WHERE id = ?').get(row.employee_id);
  const location = db.prepare('SELECT name, scope FROM locations WHERE id = ?').get(row.location_id);
  const outLocation = row.out_location_id
    ? db.prepare('SELECT name, scope FROM locations WHERE id = ?').get(row.out_location_id)
    : null;
  const everywhere = location?.scope === 'everywhere';
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: employee?.name ? `${employee.name}${employee.deleted_at ? ' (dihapus)' : ''}` : '',
    phone: employee?.phone || '',
    businessId: employee?.business_id || '',
    businessName: businessName(employee?.business_id),
    locationId: row.location_id,
    locationName: everywhere ? 'Everywhere' : (location?.name || ''),
    everywhere,
    outLocationId: row.out_location_id,
    outLocationName: outLocation?.scope === 'everywhere' ? 'Everywhere' : (outLocation?.name || ''),
    clockInAt: row.clock_in_at,
    clockOutAt: row.clock_out_at,
    inLat: row.in_lat,
    inLng: row.in_lng,
    inAccuracy: row.in_accuracy,
    inDistanceMeters: row.in_distance_meters,
    inFaceDistance: row.in_face_distance,
    inLiveness: row.in_liveness,
    inFrames: JSON.parse(row.in_frames || '[]'),
    outLat: row.out_lat,
    outLng: row.out_lng,
    outAccuracy: row.out_accuracy,
    outDistanceMeters: row.out_distance_meters,
    outFaceDistance: row.out_face_distance,
    outLiveness: row.out_liveness,
    outFrames: JSON.parse(row.out_frames || '[]'),
    lateMinutes: row.late_minutes,
    outAuto: row.out_auto === 1,
    hoursWorked: workedHours(row.clock_in_at, row.clock_out_at)
  };
}

export function getAttendance(db, id) {
  const row = db.prepare('SELECT * FROM attendance WHERE id = ?').get(id);
  return row ? mapAttendance(db, row) : null;
}

export function listAttendance(db, { dari, sampai, employeeId, locationId, limit = 500 }) {
  const { start, end } = rangeFromLabels(dari, sampai);
  const clauses = ['clock_in_at >= ?', 'clock_in_at < ?'];
  const params = [start.toISOString(), end.toISOString()];
  if (employeeId) {
    clauses.push('employee_id = ?');
    params.push(employeeId);
  }
  if (locationId) {
    clauses.push('(location_id = ? OR out_location_id = ?)');
    params.push(locationId, locationId);
  }
  params.push(limit);
  const rows = db.prepare(`SELECT * FROM attendance WHERE ${clauses.join(' AND ')} ORDER BY clock_in_at DESC LIMIT ?`).all(...params);
  return rows.map((row) => mapAttendance(db, row));
}

export function employeeHistory(db, employeeId, limit = 30) {
  const rows = db.prepare('SELECT * FROM attendance WHERE employee_id = ? ORDER BY clock_in_at DESC LIMIT ?').all(employeeId, limit);
  return rows.map((row) => mapAttendance(db, row));
}

export function getSettings(db, config = {}) {
  const rows = db.prepare('SELECT key, value FROM app_settings').all();
  return settingsFromRows(rows, config);
}

export function saveSettings(db, input, config = {}) {
  const settings = settingsFromRows(
    Object.entries(serializeSettings(settingsFromRows(
      Object.entries(input || {}).map(([key, value]) => ({ key, value })),
      config
    ))).map(([key, value]) => ({ key, value })),
    config
  );
  const stored = serializeSettings(settings);
  const upsert = db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  transaction(db, () => {
    for (const [key, value] of Object.entries(stored)) upsert.run(key, value);
  });
  return settings;
}

export function lastPunchAt(db, employeeId) {
  const row = db.prepare(`
    SELECT MAX(ts) AS ts FROM (
      SELECT clock_in_at AS ts FROM attendance WHERE employee_id = ?
      UNION ALL
      SELECT clock_out_at AS ts FROM attendance WHERE employee_id = ? AND clock_out_at IS NOT NULL
    )
  `).get(employeeId, employeeId);
  return row?.ts || null;
}

export function closeStaleSessions(db, now, autoTime) {
  const today = jakartaDateLabel(now);
  const open = db.prepare('SELECT id, clock_in_at, location_id FROM attendance WHERE clock_out_at IS NULL').all();
  const update = db.prepare(`UPDATE attendance
    SET clock_out_at = ?, out_location_id = ?, out_liveness = 'auto', out_auto = 1
    WHERE id = ? AND clock_out_at IS NULL`);
  return transaction(db, () => {
    let closed = 0;
    for (const row of open) {
      if (jakartaDateLabel(new Date(row.clock_in_at)) >= today) continue;
      const clockOutAt = staleClockOutIso(row.clock_in_at, autoTime);
      if (!clockOutAt) continue;
      const result = update.run(clockOutAt, row.location_id, row.id);
      closed += result.changes || 0;
    }
    return closed;
  });
}

export function sweepAutoClockOut(db, config, now = new Date()) {
  return closeStaleSessions(db, now, getSettings(db, config).autoClockOutTime);
}

export function correctSession(db, id, clockOutAt) {
  const row = db.prepare('SELECT * FROM attendance WHERE id = ?').get(id);
  if (!row) return { error: 'not_found' };
  const outAt = new Date(clockOutAt);
  if (!Number.isFinite(outAt.getTime()) || outAt.getTime() <= new Date(row.clock_in_at).getTime()) return { error: 'bad_request' };
  db.prepare(`UPDATE attendance
    SET clock_out_at = ?, out_location_id = COALESCE(out_location_id, location_id),
        out_liveness = 'koreksi', out_auto = 0
    WHERE id = ?`).run(outAt.toISOString(), id);
  return { attendance: getAttendance(db, id) };
}

export function weeklyHeadcount(db, now = new Date()) {
  const today = jakartaDateLabel(now);
  const start = new Date(rangeFromLabels(today, today).start.getTime() - 6 * 24 * 60 * 60 * 1000);
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const label = jakartaDateLabel(new Date(start.getTime() + i * 24 * 60 * 60 * 1000));
    days.push(label);
  }
  return days.map((label) => {
    const range = rangeFromLabels(label, label);
    const row = db.prepare(`SELECT COUNT(DISTINCT employee_id) AS n FROM attendance
      WHERE clock_in_at >= ? AND clock_in_at < ?`).get(range.start.toISOString(), range.end.toISOString());
    return { tanggal: label, jumlah: row.n };
  });
}

export function importSessions(db, rows) {
  const employees = listEmployees(db);
  const byPhone = new Map(employees.map((employee) => [employee.phone, employee]));
  const byName = new Map(employees.map((employee) => [employee.name.trim().toLowerCase(), employee]));
  const insert = db.prepare(`INSERT INTO attendance (
    employee_id, location_id, clock_in_at, clock_out_at, in_lat, in_lng, in_accuracy, in_distance_meters,
    in_photo, in_frames, in_face_distance, in_liveness, out_lat, out_lng, out_accuracy, out_distance_meters,
    out_photo, out_frames, out_face_distance, out_liveness, out_location_id, late_minutes, out_auto, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, '', '[]', 0, 'impor', ?, ?, ?, ?, '', '[]', ?, ?, ?, ?, 0, ?)`);
  const exists = db.prepare('SELECT id FROM attendance WHERE employee_id = ? AND clock_in_at = ?');
  let masuk = 0;
  const galat = [];
  transaction(db, () => {
    rows.forEach((row, index) => {
      if (row.error) {
        galat.push({ baris: index + 2, alasan: row.error });
        return;
      }
      const phone = normalizePhone(row.phone);
      const employee = (phone && byPhone.get(phone)) || byName.get(String(row.name || '').trim().toLowerCase());
      if (!employee) {
        galat.push({ baris: index + 2, alasan: 'karyawan_tidak_dikenal' });
        return;
      }
      if (exists.get(employee.id, row.clockInAt)) {
        galat.push({ baris: index + 2, alasan: 'sudah_ada' });
        return;
      }
      const locationId = employee.locationIds[0];
      if (!locationId) {
        galat.push({ baris: index + 2, alasan: 'tanpa_lokasi' });
        return;
      }
      const location = getLocation(db, locationId);
      insert.run(
        employee.id,
        locationId,
        row.clockInAt,
        row.clockOutAt,
        location?.latitude || 0,
        location?.longitude || 0,
        row.clockOutAt ? location?.latitude || 0 : null,
        row.clockOutAt ? location?.longitude || 0 : null,
        row.clockOutAt ? 0 : null,
        row.clockOutAt ? 0 : null,
        row.clockOutAt ? 0 : null,
        row.clockOutAt ? 'impor' : null,
        row.clockOutAt ? locationId : null,
        null,
        row.clockInAt
      );
      masuk += 1;
    });
  });
  return { masuk, dilewati: galat.length, galat };
}

export function todayBoard(db, now = new Date(), config = {}) {
  const settings = getSettings(db, config);
  const { dari } = jakartaDayRange(now);
  const day = rangeFromLabels(dari, dari);
  const employees = listEmployees(db).filter((employee) => employee.active);
  const records = listAttendance(db, { dari, sampai: dari, limit: 2000 });
  const grouped = new Map();
  for (const record of records) {
    if (!grouped.has(record.employeeId)) grouped.set(record.employeeId, []);
    grouped.get(record.employeeId).push(record);
  }
  const people = employees.map((employee) => {
    const sesi = (grouped.get(employee.id) || []).sort((a, b) => a.clockInAt.localeCompare(b.clockInAt));
    const record = sesi.length ? sesi[sesi.length - 1] : null;
    const first = sesi[0] || null;
    const flag = first ? arrivalFlag(first.clockInAt, { lateThreshold: settings.lateThreshold, shiftStart: employee.shiftStart }) : null;
    let status = 'belum';
    if (sesi.some((item) => !item.clockOutAt)) status = 'bekerja';
    else if (record) status = 'pulang';
    return {
      employee,
      record,
      sesi,
      jam: sumCompletedHours(sesi),
      flag,
      status,
      late: flag === 'terlambat',
      early: flag === 'awal',
      auto: sesi.some((item) => item.outAuto)
    };
  });
  const jam = Math.round(people.reduce((sum, person) => sum + person.jam, 0) * 100) / 100;
  return {
    tanggal: dari,
    mulai: day.start.toISOString(),
    pengaturan: settings,
    minggu: weeklyHeadcount(db, now),
    ringkasan: {
      total: people.length,
      hadir: people.filter((person) => person.record).length,
      belum: people.filter((person) => !person.record).length,
      terlambat: people.filter((person) => person.late).length,
      awal: people.filter((person) => person.early).length,
      jam,
      sedangBekerja: people.filter((person) => person.status === 'bekerja').length,
      sudahPulang: people.filter((person) => person.status === 'pulang').length
    },
    karyawan: people
  };
}

export function recap(db, { dari, sampai, employeeId = null, locationId = null }) {
  const records = listAttendance(db, { dari, sampai, employeeId, locationId, limit: 10000 });
  let employees = listEmployees(db);
  if (employeeId) employees = employees.filter((employee) => employee.id === employeeId);
  else if (locationId) employees = [];
  const groups = new Map();
  for (const employee of employees) {
    groups.set(employee.id, {
      employeeId: employee.id,
      name: employee.name,
      phone: employee.phone,
      businessName: employee.businessName,
      active: employee.active,
      shifts: 0,
      days: new Set(),
      lateCount: 0,
      lateMinutes: 0,
      hours: 0,
      openShifts: 0
    });
  }
  for (const record of records) {
    if (!groups.has(record.employeeId)) {
      groups.set(record.employeeId, {
        employeeId: record.employeeId,
        name: record.employeeName,
        phone: record.phone,
        businessName: record.businessName,
        active: false,
        shifts: 0,
        days: new Set(),
        lateCount: 0,
        lateMinutes: 0,
        hours: 0,
        openShifts: 0
      });
    }
    const bucket = groups.get(record.employeeId);
    bucket.shifts += 1;
    bucket.days.add(jakartaDateLabel(new Date(record.clockInAt)));
    if ((record.lateMinutes || 0) > 0) {
      bucket.lateCount += 1;
      bucket.lateMinutes += record.lateMinutes;
    }
    if (record.hoursWorked != null) bucket.hours += record.hoursWorked;
    else bucket.openShifts += 1;
  }
  return [...groups.values()]
    .filter((bucket) => bucket.active || bucket.shifts > 0)
    .map((bucket) => ({
      ...bucket,
      days: bucket.days.size,
      hours: Math.round(bucket.hours * 100) / 100
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

export function createSession(db, { tokenHash, kind, subjectId, expiresAt }) {
  db.prepare('INSERT INTO sessions (token_hash, kind, subject_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run(
    tokenHash,
    kind,
    subjectId,
    expiresAt,
    new Date().toISOString()
  );
}

export function getSession(db, tokenHash) {
  return db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash);
}

export function deleteSession(db, tokenHash) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function createChallenge(db, { tokenHash, employeeId, expiresAt }) {
  db.prepare('INSERT INTO challenges (token_hash, employee_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    tokenHash,
    employeeId,
    expiresAt,
    new Date().toISOString()
  );
}

export function consumeChallenge(db, tokenHash, employeeId, nowIso) {
  const result = db.prepare(`
    UPDATE challenges
    SET used_at = ?
    WHERE token_hash = ? AND employee_id = ? AND used_at IS NULL AND expires_at > ?
  `).run(nowIso, tokenHash, employeeId, nowIso);
  return result.changes === 1;
}

export function attendancePhoto(db, id, phase) {
  const row = db.prepare('SELECT employee_id, in_photo, in_frames, out_photo, out_frames FROM attendance WHERE id = ?').get(id);
  if (!row) return null;
  const frames = JSON.parse(phase === 'pulang' ? (row.out_frames || '[]') : (row.in_frames || '[]'));
  const primary = phase === 'pulang' ? row.out_photo : row.in_photo;
  return { employeeId: row.employee_id, primary, frames };
}
