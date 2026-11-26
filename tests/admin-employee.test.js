import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cookiePair, listen, request } from './http.js';

const PHONE = '081299000001';
const PIN = '9081';

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hadir-admin-emp-'));
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
  process.env.ADMIN_PHONE = PHONE;
  process.env.ADMIN_PIN = PIN;
  const { createApp } = await import('../src/app.js');
  const app = await createApp();
  const server = await listen(app);
  return {
    server,
    app,
    dir,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      app.locals.db.close();
      fs.rmSync(dir, { recursive: true, force: true });
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };
}

test('PIN depan admin membuka sesi admin dan karyawan biasa ditolak', async () => {
  const ctx = await boot();
  try {
    const masuk = await request(ctx.server, {
      method: 'POST',
      path: '/api/karyawan/masuk',
      json: { phone: `62${PHONE.slice(1)}`, pin: PIN }
    });
    assert.equal(masuk.status, 200, JSON.stringify(masuk.data));
    assert.equal(masuk.data.admin, true);
    assert.equal(masuk.data.karyawan.phone, PHONE);
    assert.equal(masuk.data.karyawan.name, 'Admin');
    assert.ok(masuk.data.karyawan.locationIds.length > 0);
    const employeeCookie = cookiePair(masuk.setCookie, 'hadir_karyawan');
    const adminCookie = cookiePair(masuk.setCookie, 'hadir_admin');
    assert.ok(employeeCookie);
    assert.ok(adminCookie);

    const board = await request(ctx.server, { path: '/api/admin/hari-ini', cookie: adminCookie });
    assert.equal(board.status, 200, JSON.stringify(board.data));
    const saya = await request(ctx.server, { path: '/api/karyawan/saya', cookie: `${employeeCookie}; ${adminCookie}` });
    assert.equal(saya.data.admin, true);
    assert.equal(saya.data.karyawan.name, 'Admin');

    const daftar = await request(ctx.server, { path: '/api/admin/karyawan', cookie: adminCookie });
    assert.equal(daftar.data.karyawan.some((item) => item.phone === PHONE && item.name === 'Admin'), true);

    const keluar = await request(ctx.server, {
      method: 'POST',
      path: '/api/karyawan/keluar',
      cookie: `${employeeCookie}; ${adminCookie}`,
      json: {}
    });
    assert.equal(keluar.status, 200);
    const setelahKeluar = await request(ctx.server, { path: '/api/admin/saya', cookie: adminCookie });
    assert.equal(setelahKeluar.status, 401);

    const pintuAdmin = await request(ctx.server, {
      method: 'POST',
      path: '/api/admin/masuk',
      json: { phone: PHONE, pin: PIN }
    });
    assert.equal(pintuAdmin.status, 200, JSON.stringify(pintuAdmin.data));
    const adminLagi = cookiePair(pintuAdmin.setCookie, 'hadir_admin');
    const ganti = await request(ctx.server, {
      method: 'POST',
      path: '/api/admin/pin',
      cookie: adminLagi,
      json: { pin: '4321' }
    });
    assert.equal(ganti.status, 200, JSON.stringify(ganti.data));
    const pinLama = await request(ctx.server, {
      method: 'POST',
      path: '/api/karyawan/masuk',
      json: { phone: PHONE, pin: PIN }
    });
    assert.equal(pinLama.status, 401);
    const pinBaru = await request(ctx.server, {
      method: 'POST',
      path: '/api/karyawan/masuk',
      json: { phone: PHONE, pin: '4321' }
    });
    assert.equal(pinBaru.status, 200, JSON.stringify(pinBaru.data));
    assert.equal(pinBaru.data.admin, true);
    assert.ok(cookiePair(pinBaru.setCookie, 'hadir_admin'));

    const biasa = await request(ctx.server, {
      method: 'POST',
      path: '/api/karyawan/masuk',
      json: { phone: '081210000002', pin: '908172' }
    });
    assert.equal(biasa.status, 200, JSON.stringify(biasa.data));
    assert.equal(biasa.data.admin, false);
    assert.equal(cookiePair(biasa.setCookie, 'hadir_admin'), '');
    const ditolak = await request(ctx.server, {
      path: '/api/admin/hari-ini',
      cookie: cookiePair(biasa.setCookie, 'hadir_karyawan')
    });
    assert.equal(ditolak.status, 403);
    assert.equal(ditolak.data.error, 'forbidden');
    const tanpaSesi = await request(ctx.server, { path: '/api/admin/hari-ini' });
    assert.equal(tanpaSesi.status, 401);
  } finally {
    await ctx.close();
  }
});
