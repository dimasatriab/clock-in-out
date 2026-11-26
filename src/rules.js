import { lateMinutes } from './time.js';

export function evaluateClock({
  action,
  employeeActive,
  faceSampleCount,
  openAttendance,
  geofence,
  faceDistance,
  maxFaceDistance,
  shiftStart,
  graceMinutes,
  now
}) {
  if (action !== 'in' && action !== 'out') return { ok: false, error: 'bad_action' };
  if (!employeeActive) return { ok: false, error: 'inactive' };
  if (!faceSampleCount || faceSampleCount < 1) return { ok: false, error: 'face_not_enrolled' };
  if (action === 'in' && openAttendance) return { ok: false, error: 'already_in' };
  if (action === 'out' && !openAttendance) return { ok: false, error: 'not_clocked_in' };
  if (!geofence?.ok) return { ok: false, error: geofence?.error || 'gps_invalid', accuracy: geofence?.accuracy };
  if (!Number.isFinite(faceDistance) || faceDistance < 0 || faceDistance > maxFaceDistance) {
    return { ok: false, error: 'face_mismatch', faceDistance };
  }
  return {
    ok: true,
    lateMinutes: action === 'in' ? lateMinutes(now, shiftStart, graceMinutes) : null,
    locationId: geofence.locationId,
    distanceMeters: geofence.distanceMeters,
    method: 'wajah'
  };
}
