import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateSqlite } from './migrate.js';

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  locked_until TEXT
);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  radius_meters REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  shift_start TEXT,
  grace_minutes INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employee_locations (
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (employee_id, location_id)
);

CREATE TABLE IF NOT EXISTS face_samples (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  descriptor TEXT NOT NULL,
  image_path TEXT NOT NULL,
  pose TEXT,
  quality_score REAL,
  sharpness REAL,
  yaw REAL,
  pitch REAL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  out_location_id INTEGER REFERENCES locations(id),
  clock_in_at TEXT NOT NULL,
  clock_out_at TEXT,
  in_lat REAL NOT NULL,
  in_lng REAL NOT NULL,
  in_accuracy REAL NOT NULL,
  in_distance_meters REAL NOT NULL,
  in_photo TEXT NOT NULL,
  in_frames TEXT NOT NULL,
  in_face_distance REAL NOT NULL,
  in_liveness TEXT NOT NULL,
  out_lat REAL,
  out_lng REAL,
  out_accuracy REAL,
  out_distance_meters REAL,
  out_photo TEXT,
  out_frames TEXT,
  out_face_distance REAL,
  out_liveness TEXT,
  late_minutes INTEGER,
  out_auto INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  subject_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS challenges (
  token_hash TEXT PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attendance_employee ON attendance(employee_id, clock_in_at);
CREATE INDEX IF NOT EXISTS idx_attendance_open ON attendance(employee_id, clock_out_at);
CREATE INDEX IF NOT EXISTS idx_attendance_in ON attendance(clock_in_at);
`;

export function openDatabase(config) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(path.join(config.dataDir, 'uploads'), { recursive: true });
  const db = new DatabaseSync(path.join(config.dataDir, 'hadir.sqlite'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  migrateSqlite(db);
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* already closed */ }
    throw error;
  }
}
