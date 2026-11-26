import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cookiePair, listen, request } from './http.js';

test('kunci admin menahan sesi admin dari PIN depan', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hadir-admin-lock-'));
  const previous = {
    DATA_DIR: process.env.DATA_DIR,
    NODE_ENV: process.env.NODE_ENV,
    DEMO: process.env.DEMO,
    DEMO_PIN: process.env.DEMO_PIN,
    ADMIN_PHONE: process.env.ADMIN_PHONE,
    ADMIN_PIN: process.env.ADMIN_PIN
  };
  process.env.DATA_DIR = dir;
  process.env.NODE_ENV = 'test';
  process.env.DEMO = '1';
  process.env.DEMO_PIN = '908172';
  process.env.ADMIN_PHONE = '081299000001';
  process.env.ADMIN_PIN = '9081';
  const { createApp } = await import('../src/app.js');
  const app = await createApp();
  const server = await listen(app);
  try {
    for (let i = 0; i < 5; i += 1) {
      const bad = await request(server, {
        method: 'POST',
        path: '/api/admin/masuk',
        json: { phone: '081299000001', pin: '1111' }
      });
      assert.equal(bad.status, 401, JSON.stringify(bad.data));
    }
    const masuk = await request(server, {
      method: 'POST',
      path: '/api/karyawan/masuk',
      json: { phone: '081299000001', pin: '9081' }
    });
    assert.equal(masuk.status, 200, JSON.stringify(masuk.data));
    assert.equal(masuk.data.admin, false);
    assert.equal(masuk.data.karyawan.name, 'Admin');
    assert.equal(cookiePair(masuk.setCookie, 'hadir_admin'), '');
    assert.ok(cookiePair(masuk.setCookie, 'hadir_karyawan'));
    const ditolak = await request(server, {
      path: '/api/admin/saya',
      cookie: cookiePair(masuk.setCookie, 'hadir_karyawan')
    });
    assert.equal(ditolak.status, 403);
    assert.equal(ditolak.data.error, 'forbidden');
    const terkunci = await request(server, {
      method: 'POST',
      path: '/api/admin/masuk',
      json: { phone: '081299000001', pin: '9081' }
    });
    assert.equal(terkunci.status, 429);
    assert.equal(terkunci.data.error, 'locked');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    app.locals.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
