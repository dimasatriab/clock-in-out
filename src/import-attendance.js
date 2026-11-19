import { isDateLabel, wibDateTime } from './time.js';

const ALIAS = new Map([
  ['nama', 'name'],
  ['name', 'name'],
  ['employee', 'name'],
  ['karyawan', 'name'],
  ['telepon', 'phone'],
  ['phone', 'phone'],
  ['hp', 'phone'],
  ['nomor hp', 'phone'],
  ['tanggal', 'date'],
  ['date', 'date'],
  ['masuk', 'in'],
  ['clock in', 'in'],
  ['jam masuk', 'in'],
  ['jam masuk (wib)', 'in'],
  ['pulang', 'out'],
  ['clock out', 'out'],
  ['jam pulang', 'out'],
  ['jam pulang (wib)', 'out']
]);

function headerKey(value) {
  return ALIAS.get(String(value || '').trim().toLowerCase()) || null;
}

function splitCsvLine(line, delimiter) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted && char === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = '';
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseDelimited(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes(';') ? ';' : (lines[0].includes('\t') ? '\t' : ',');
  const headers = splitCsvLine(lines[0], delimiter).map(headerKey);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line, delimiter);
    const row = {};
    headers.forEach((key, index) => {
      if (key) row[key] = cells[index] || '';
    });
    return row;
  }).filter((row) => row.name || row.phone || row.date);
}

function parseSpreadsheet(text) {
  const rows = [];
  const rowMatches = text.match(/<Row\b[\s\S]*?<\/Row>/g) || [];
  for (const chunk of rowMatches) {
    const cells = [...chunk.matchAll(/<Data\b[^>]*>([\s\S]*?)<\/Data>/g)].map((match) => match[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim());
    rows.push(cells);
  }
  if (rows.length < 2) return [];
  const headers = rows[0].map(headerKey);
  return rows.slice(1).map((cells) => {
    const row = {};
    headers.forEach((key, index) => {
      if (key) row[key] = cells[index] || '';
    });
    return row;
  }).filter((row) => row.name || row.phone || row.date);
}

export function parseAttendanceTable(content) {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : String(content || '');
  if (text.includes('<Row') && text.includes('<Data')) return parseSpreadsheet(text);
  return parseDelimited(text);
}

export function normalizeImportRow(row) {
  const date = String(row.date || '').slice(0, 10);
  const clockIn = String(row.in || '').trim();
  const clockOut = String(row.out || '').trim();
  if (!isDateLabel(date) || !clockIn) return { error: 'baris_tidak_lengkap' };
  const clockInAt = wibDateTime(date, clockIn);
  const clockOutAt = clockOut ? wibDateTime(date, clockOut) : null;
  if (!clockInAt || (clockOut && !clockOutAt)) return { error: 'baris_tidak_lengkap' };
  if (clockOutAt && new Date(clockOutAt).getTime() <= new Date(clockInAt).getTime()) return { error: 'jam_terbalik' };
  return {
    name: String(row.name || '').trim(),
    phone: String(row.phone || '').trim(),
    clockInAt,
    clockOutAt
  };
}
