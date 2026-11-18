const ZONE = 'Asia/Jakarta';

export function jakartaParts(date) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
  );
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

export function pad2(value) {
  return String(value).padStart(2, '0');
}

export function jakartaDateLabel(date) {
  const parts = jakartaParts(date);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

export function jakartaDayRange(now = new Date()) {
  const label = jakartaDateLabel(now);
  return rangeFromLabels(label, label);
}

export function rangeFromLabels(dari, sampai) {
  const start = jakartaMidnightUtc(dari);
  const end = new Date(jakartaMidnightUtc(sampai).getTime() + 24 * 60 * 60 * 1000);
  return { start, end, dari, sampai };
}

export function jakartaMidnightUtc(label) {
  const [year, month, day] = label.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, -7, 0, 0, 0));
}

export function shiftToMinutes(shiftStart) {
  if (!shiftStart) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(shiftStart);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function lateMinutes(clockIn, shiftStart, graceMinutes = 0) {
  const start = shiftToMinutes(shiftStart);
  if (start == null) return null;
  const parts = jakartaParts(new Date(clockIn));
  const actual = parts.hour * 60 + parts.minute;
  const late = actual - start - (Number(graceMinutes) || 0);
  return late > 0 ? late : 0;
}

export function workedHours(clockIn, clockOut) {
  if (!clockOut) return null;
  const ms = new Date(clockOut).getTime() - new Date(clockIn).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round((ms / 36e5) * 100) / 100;
}

export function formatWibDate(iso) {
  if (!iso) return '';
  return jakartaDateLabel(new Date(iso));
}

export function formatWibTime(iso) {
  if (!iso) return '';
  const parts = jakartaParts(new Date(iso));
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

export function formatDurasi(hours) {
  if (hours == null) return '';
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h <= 0) return `${m} mnt`;
  return `${h} jam ${m} mnt`;
}

export function isDateLabel(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return false;
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

export function defaultRange(now = new Date()) {
  const sampai = jakartaDateLabel(now);
  const start = new Date(jakartaMidnightUtc(sampai).getTime() - 6 * 24 * 60 * 60 * 1000);
  return { dari: jakartaDateLabel(start), sampai };
}
