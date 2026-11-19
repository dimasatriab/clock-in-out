const FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

export function assertNotLocked(db, key, now = new Date()) {
  const row = db.prepare('SELECT failures, locked_until FROM login_attempts WHERE key = ?').get(key);
  if (row?.locked_until && new Date(row.locked_until).getTime() > now.getTime()) {
    return { ok: false, error: 'locked' };
  }
  return { ok: true };
}

export function recordLoginFailure(db, key, now = new Date()) {
  const row = db.prepare('SELECT failures, locked_until FROM login_attempts WHERE key = ?').get(key);
  const stillLocked = row?.locked_until && new Date(row.locked_until).getTime() > now.getTime();
  const failures = stillLocked ? row.failures : (row?.failures || 0) + 1;
  const lockedUntil = failures >= FAILURES ? new Date(now.getTime() + LOCK_MS).toISOString() : null;
  db.prepare(`INSERT INTO login_attempts (key, failures, locked_until) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET failures = excluded.failures, locked_until = excluded.locked_until`).run(key, failures, lockedUntil);
  return { failures, locked: failures >= FAILURES };
}

export function clearLoginFailures(db, key) {
  db.prepare('DELETE FROM login_attempts WHERE key = ?').run(key);
}
