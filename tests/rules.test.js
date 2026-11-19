import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateClock } from '../src/rules.js';
import { lateMinutes, workedHours, jakartaDayRange } from '../src/time.js';

function base(overrides = {}) {
  return {
    action: 'in',
    employeeActive: true,
    faceSampleCount: 3,
    openAttendance: null,
    geofence: { ok: true, locationId: 7, distanceMeters: 12 },
    faceDistance: 0.2,
    maxFaceDistance: 0.5,
    liveness: { ok: true, method: 'kedip' },
    shiftStart: '09:00',
    graceMinutes: 10,
    now: new Date('2026-11-18T02:00:00.000Z'),
    ...overrides
  };
}

test('absen masuk tepat waktu dan absen terlambat di WIB', () => {
  assert.equal(evaluateClock(base()).lateMinutes, 0);
  const late = evaluateClock(base({ now: new Date('2026-11-18T02:20:00.000Z') }));
  assert.equal(late.ok, true);
  assert.equal(late.lateMinutes, 10);
  assert.equal(late.locationId, 7);
  assert.equal(evaluateClock(base({ shiftStart: null })).lateMinutes, null);
  assert.equal(lateMinutes('2026-11-18T01:00:00.000Z', '09:00', 10), 0);
});

test('aturan menolak keadaan absen yang tidak sah', () => {
  assert.equal(evaluateClock(base({ employeeActive: false })).error, 'inactive');
  assert.equal(evaluateClock(base({ faceSampleCount: 0 })).error, 'face_not_enrolled');
  assert.equal(evaluateClock(base({ openAttendance: { id: 1 } })).error, 'already_in');
  assert.equal(evaluateClock(base({ action: 'out', openAttendance: null })).error, 'not_clocked_in');
  assert.equal(evaluateClock(base({ geofence: { ok: false, error: 'outside_geofence' } })).error, 'outside_geofence');
  assert.equal(evaluateClock(base({ geofence: { ok: false, error: 'gps_inaccurate', accuracy: 240 } })).error, 'gps_inaccurate');
  assert.equal(evaluateClock(base({ faceDistance: 0.5 })).ok, true);
  assert.equal(evaluateClock(base({ faceDistance: 0.5001 })).error, 'face_mismatch');
  assert.equal(evaluateClock(base({ faceDistance: Number.NaN })).error, 'face_mismatch');
  assert.equal(evaluateClock(base({ action: 'out', openAttendance: { id: 4 } })).ok, true);
});

test('rentang hari WIB dan jam kerja', () => {
  const range = jakartaDayRange(new Date('2026-11-18T03:00:00.000Z'));
  assert.equal(range.dari, '2026-11-18');
  assert.equal(range.start.toISOString(), '2026-11-17T17:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-11-18T17:00:00.000Z');
  assert.equal(workedHours('2026-11-18T01:00:00.000Z', '2026-11-18T09:30:00.000Z'), 8.5);
  assert.equal(workedHours('2026-11-18T01:00:00.000Z', null), null);
});
