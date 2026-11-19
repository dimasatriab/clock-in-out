export const SETTING_DEFAULTS = {
  faceDistanceThreshold: 0.5,
  frameSkip: 3,
  confirmationTimeoutSeconds: 10,
  detectionCooldownSeconds: 30,
  sharpnessMin: 50,
  autoClockOutTime: '20:00',
  lateThreshold: '09:30:00',
  maxEnrollmentFrames: 12,
  audioAnnouncements: true
};

const STORED_KEYS = {
  faceDistanceThreshold: 'face_distance_threshold',
  frameSkip: 'frame_skip',
  confirmationTimeoutSeconds: 'confirmation_timeout_seconds',
  detectionCooldownSeconds: 'detection_cooldown_seconds',
  sharpnessMin: 'sharpness_min',
  autoClockOutTime: 'auto_clockout_time',
  lateThreshold: 'late_threshold',
  maxEnrollmentFrames: 'max_enrollment_frames',
  audioAnnouncements: 'audio_announcements'
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function numberIn(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max);
}

function clockOr(value, fallback, withSeconds) {
  const text = String(value || '').trim();
  const pattern = withSeconds ? /^(\d{2}):(\d{2}):(\d{2})$/ : /^(\d{2}):(\d{2})$/;
  const match = pattern.exec(text);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = withSeconds ? Number(match[3]) : 0;
  if (hour > 23 || minute > 59 || second > 59) return fallback;
  return withSeconds ? text : text;
}

export function normalizeSettings(input = {}, config = {}) {
  const source = input || {};
  const envThreshold = Number(config.faceMaxDistance);
  const thresholdFallback = Number.isFinite(envThreshold) ? envThreshold : SETTING_DEFAULTS.faceDistanceThreshold;
  const audio = source.audioAnnouncements ?? source.audio_announcements;
  return {
    faceDistanceThreshold: Math.round(numberIn(
      source.faceDistanceThreshold ?? source.face_distance_threshold,
      0.2,
      0.8,
      thresholdFallback
    ) * 100) / 100,
    frameSkip: Math.round(numberIn(source.frameSkip ?? source.frame_skip, 1, 10, SETTING_DEFAULTS.frameSkip)),
    confirmationTimeoutSeconds: Math.round(numberIn(
      source.confirmationTimeoutSeconds ?? source.confirmation_timeout_seconds,
      3,
      60,
      SETTING_DEFAULTS.confirmationTimeoutSeconds
    )),
    detectionCooldownSeconds: Math.round(numberIn(
      source.detectionCooldownSeconds ?? source.detection_cooldown_seconds,
      0,
      300,
      SETTING_DEFAULTS.detectionCooldownSeconds
    )),
    sharpnessMin: Math.round(numberIn(source.sharpnessMin ?? source.sharpness_min, 0, 500, SETTING_DEFAULTS.sharpnessMin)),
    autoClockOutTime: clockOr(source.autoClockOutTime ?? source.auto_clockout_time, SETTING_DEFAULTS.autoClockOutTime, false),
    lateThreshold: clockOr(source.lateThreshold ?? source.late_threshold, SETTING_DEFAULTS.lateThreshold, true),
    maxEnrollmentFrames: Math.round(numberIn(
      source.maxEnrollmentFrames ?? source.max_enrollment_frames,
      5,
      40,
      SETTING_DEFAULTS.maxEnrollmentFrames
    )),
    audioAnnouncements: audio == null ? SETTING_DEFAULTS.audioAnnouncements : audio === true || audio === 1 || audio === '1' || audio === 'true'
  };
}

export function serializeSettings(settings) {
  const rows = {};
  for (const [camel, key] of Object.entries(STORED_KEYS)) {
    const value = settings[camel];
    rows[key] = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
  }
  return rows;
}

export function settingsFromRows(rows, config) {
  const stored = {};
  for (const row of rows || []) stored[row.key] = row.value;
  return normalizeSettings(stored, config);
}

export function assertCooldown(lastPunchIso, now, seconds) {
  const windowSeconds = Number(seconds) || 0;
  if (!lastPunchIso || windowSeconds <= 0) return { ok: true, remaining: 0 };
  const elapsed = (new Date(now).getTime() - new Date(lastPunchIso).getTime()) / 1000;
  if (!Number.isFinite(elapsed) || elapsed >= windowSeconds) return { ok: true, remaining: 0 };
  return { ok: false, error: 'cooldown', remaining: Math.ceil(windowSeconds - elapsed) };
}
