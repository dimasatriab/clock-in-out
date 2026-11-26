const streams = new Set();

function mapNotice(row) {
  return {
    id: row.id,
    attendanceId: row.attendance_id,
    action: row.action,
    employeeName: row.employee_name,
    clockAt: row.clock_at,
    locationName: row.location_name,
    lat: row.lat,
    lng: row.lng,
    accuracy: row.accuracy,
    faceDistance: row.face_distance,
    read: Boolean(row.read_at)
  };
}

export function addNotice(db, notice) {
  const result = db.prepare(`
    INSERT INTO admin_notices (
      attendance_id, action, employee_name, clock_at, location_name,
      lat, lng, accuracy, face_distance, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    notice.attendanceId,
    notice.action,
    notice.employeeName,
    notice.clockAt,
    notice.locationName || '',
    notice.lat,
    notice.lng,
    notice.accuracy,
    notice.faceDistance,
    new Date().toISOString()
  );
  const row = db.prepare('SELECT * FROM admin_notices WHERE id = ?').get(result.lastInsertRowid);
  const mapped = mapNotice(row);
  const payload = `data: ${JSON.stringify(mapped)}\n\n`;
  for (const stream of streams) stream.write(payload);
  return mapped;
}

export function listNotices(db, limit = 30) {
  return db.prepare('SELECT * FROM admin_notices ORDER BY id DESC LIMIT ?').all(limit).map(mapNotice);
}

export function unreadCount(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM admin_notices WHERE read_at IS NULL').get().n;
}

export function markNoticesRead(db, nowIso) {
  db.prepare('UPDATE admin_notices SET read_at = ? WHERE read_at IS NULL').run(nowIso);
}

export function openNoticeStream(res) {
  streams.add(res);
  return () => streams.delete(res);
}

export async function postWhatsApp(config, body) {
  if (!config.waNotifyUrl) return { sent: false };
  const headers = { 'content-type': 'application/json' };
  if (config.waNotifyToken) headers.authorization = `Bearer ${config.waNotifyToken}`;
  const response = await fetch(config.waNotifyUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  return { sent: response.ok };
}

export function pushConfigured(config) {
  return Boolean(config.vapidPublic && config.vapidPrivate && config.vapidSubject);
}

export function savePushSubscription(db, adminId, subscription) {
  const endpoint = String(subscription?.endpoint || '');
  const p256dh = String(subscription?.keys?.p256dh || '');
  const auth = String(subscription?.keys?.auth || '');
  if (!endpoint || !p256dh || !auth) return { error: 'bad_request' };
  db.prepare(`
    INSERT INTO push_subscriptions (admin_id, endpoint, p256dh, auth, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET admin_id = excluded.admin_id, p256dh = excluded.p256dh, auth = excluded.auth
  `).run(adminId, endpoint, p256dh, auth, new Date().toISOString());
  return { ok: true };
}

export async function sendPush(config, db, notice) {
  if (!pushConfigured(config)) return;
  const webpush = (await import('web-push')).default;
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublic, config.vapidPrivate);
  const rows = db.prepare('SELECT * FROM push_subscriptions').all();
  const payload = JSON.stringify({
    title: notice.action === 'out' ? 'Absen pulang' : 'Absen masuk',
    body: notice.employeeName,
    url: '/admin/'
  });
  for (const row of rows) {
    try {
      await webpush.sendNotification({
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth }
      }, payload);
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(row.id);
      }
    }
  }
}

export async function publishPunch(db, config, notice) {
  const saved = addNotice(db, notice);
  const hook = {
    jenis: 'absen',
    aksi: notice.action === 'out' ? 'pulang' : 'masuk',
    nama: notice.employeeName,
    waktu: notice.clockAt,
    lokasi: notice.locationName || '',
    jarakWajah: notice.faceDistance
  };
  await Promise.all([
    postWhatsApp(config, hook).catch(() => {}),
    sendPush(config, db, saved).catch(() => {})
  ]);
  return saved;
}
