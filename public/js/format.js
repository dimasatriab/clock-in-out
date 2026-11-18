const ZONE = 'Asia/Jakarta';

function parts(date) {
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
  const bag = Object.fromEntries(fmt.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return { ...bag, hour, minute: Number(bag.minute), second: Number(bag.second) };
}

function pad(value) {
  return String(value).padStart(2, '0');
}

export function jam(date = new Date()) {
  const p = parts(date);
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

export function tanggalPanjang(date = new Date()) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

export function sapaan(date = new Date()) {
  const hour = parts(date).hour;
  if (hour < 11) return 'Selamat pagi';
  if (hour < 15) return 'Selamat siang';
  if (hour < 18) return 'Selamat sore';
  return 'Selamat malam';
}

export function jamPendek(iso) {
  if (!iso) return '—';
  const p = parts(new Date(iso));
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function tanggalPendek(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(new Date(iso));
}

export function durasi(hours) {
  if (hours == null) return '—';
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h <= 0) return `${m} mnt`;
  return `${h} jam ${m} mnt`;
}

export function hariIniLabel(date = new Date()) {
  const p = parts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}
