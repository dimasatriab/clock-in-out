import assert from 'node:assert/strict';
import test from 'node:test';
import { opsiAkurasiRendah, opsiAkurasiTinggi, opsiAwalLokasi, opsiSaatIzin, pesanLokasi } from '../public/js/lokasi.js';

test('pesan lokasi membedakan ditolak, tidak ketemu, dan timeout', () => {
  assert.match(pesanLokasi({ code: 1, message: 'User denied Geolocation' }), /Izin lokasi ditolak/);
  assert.match(pesanLokasi({ code: 2, message: 'Position unavailable' }), /GPS belum ketemu/);
  assert.match(pesanLokasi({ code: 3, message: 'Timeout expired' }), /terlalu lama/);
  assert.doesNotMatch(pesanLokasi({ code: 3, message: 'Timeout expired' }), /ditolak/);
  assert.match(pesanLokasi({ code: 1, message: 'Only secure origins are allowed' }, false), /bukan HTTPS/);
  assert.match(pesanLokasi({ code: 1, message: 'Only secure origins are allowed' }, true), /bukan HTTPS/);
});

test('percobaan ulang memakai posisi baru tanpa akurasi tinggi', () => {
  assert.equal(opsiAkurasiTinggi.enableHighAccuracy, true);
  assert.equal(opsiAkurasiTinggi.maximumAge, 0);
  assert.equal(opsiAkurasiRendah.enableHighAccuracy, false);
  assert.ok(opsiAkurasiRendah.maximumAge > 0);
  assert.ok(opsiSaatIzin.timeout > opsiAkurasiTinggi.timeout);
  assert.equal(opsiAwalLokasi('granted'), opsiAkurasiTinggi);
  assert.equal(opsiAwalLokasi('prompt'), opsiSaatIzin);
});
