export const SETTING_DEFAULTS = {
  faceDistanceThreshold: 0.5,
  confirmationTimeoutSeconds: 10,
  detectionCooldownSeconds: 30,
  autoClockOutTime: '20:00',
  lateThreshold: '09:30:00',
  audioAnnouncements: true,
  companyName: 'DBLESSMYRA',
  photoRetentionDays: 90
};

const STORED_KEYS = {
  faceDistanceThreshold: 'face_distance_threshold',
  confirmationTimeoutSeconds: 'confirmation_timeout_seconds',
  detectionCooldownSeconds: 'detection_cooldown_seconds',
  autoClockOutTime: 'auto_clockout_time',
  lateThreshold: 'late_threshold',
  audioAnnouncements: 'audio_announcements',
  companyName: 'company_name',
  photoRetentionDays: 'photo_retention_days'
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
    autoClockOutTime: clockOr(source.autoClockOutTime ?? source.auto_clockout_time, SETTING_DEFAULTS.autoClockOutTime, false),
    lateThreshold: clockOr(source.lateThreshold ?? source.late_threshold, SETTING_DEFAULTS.lateThreshold, true),
    audioAnnouncements: audio == null ? SETTING_DEFAULTS.audioAnnouncements : audio === true || audio === 1 || audio === '1' || audio === 'true',
    companyName: companyNameOr(source.companyName ?? source.company_name, SETTING_DEFAULTS.companyName),
    photoRetentionDays: Math.round(numberIn(
      source.photoRetentionDays ?? source.photo_retention_days,
      1,
      3650,
      SETTING_DEFAULTS.photoRetentionDays
    ))
  };
}

export function parseCompanyName(value) {
  if (value == null) return { ok: true, name: null };
  const text = String(value).replace(/[\u0000-\u001f]/g, '').trim();
  if (text.length < 2 || text.length > 40 || /[<>]/.test(text)) return { ok: false };
  return { ok: true, name: text };
}

function companyNameOr(value, fallback) {
  const parsed = parseCompanyName(value == null || value === '' ? fallback : value);
  return parsed.ok && parsed.name ? parsed.name : fallback;
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
