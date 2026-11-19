export function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[;"\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(';')];
  for (const row of rows) lines.push(row.map(csvCell).join(';'));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function xml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function toSpreadsheetMl(headers, rows) {
  const headerCells = headers.map((cell) => `<Cell><Data ss:Type="String">${xml(cell)}</Data></Cell>`).join('');
  const body = rows.map((row) => {
    const cells = row.map((cell) => {
      if (typeof cell === 'number' && Number.isFinite(cell)) {
        return `<Cell><Data ss:Type="Number">${cell}</Data></Cell>`;
      }
      return `<Cell><Data ss:Type="String">${xml(cell ?? '')}</Data></Cell>`;
    }).join('');
    return `<Row>${cells}</Row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Absensi"><Table>
<Row>${headerCells}</Row>
${body}
</Table></Worksheet></Workbook>`;
}

export const EXPORT_HEADERS = [
  'Tanggal',
  'Nama',
  'Nomor HP',
  'Usaha',
  'Lokasi masuk',
  'Jam masuk (WIB)',
  'Jam pulang (WIB)',
  'Terlambat (menit)',
  'Jam kerja',
  'Akurasi masuk (m)',
  'Lintang masuk',
  'Bujur masuk',
  'Jarak ke pusat masuk (m)',
  'Skor wajah masuk',
  'Lokasi pulang',
  'Akurasi pulang (m)',
  'Lintang pulang',
  'Bujur pulang',
  'Skor wajah pulang',
  'Pulang otomatis',
  'Status datang'
];
