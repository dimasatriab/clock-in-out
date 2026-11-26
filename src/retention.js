import { removeUpload } from './photos.js';

export function purgeExpiredPhotos(db, config, days, now = new Date()) {
  const windowDays = Number(days);
  if (!Number.isFinite(windowDays) || windowDays < 1) return 0;
  const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT id, in_photo, in_frames, out_photo, out_frames
    FROM attendance
    WHERE clock_in_at < ?
  `).all(cutoff);
  let removed = 0;
  for (const row of rows) {
    const paths = [
      row.in_photo,
      row.out_photo,
      ...safeList(row.in_frames),
      ...safeList(row.out_frames)
    ].filter(Boolean);
    if (!paths.length) continue;
    for (const relative of paths) removeUpload(config, relative);
    db.prepare(`
      UPDATE attendance
      SET in_photo = '', in_frames = '[]', out_photo = NULL, out_frames = NULL
      WHERE id = ?
    `).run(row.id);
    removed += 1;
  }
  return removed;
}

function safeList(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
