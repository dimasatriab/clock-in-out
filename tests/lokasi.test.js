import assert from 'node:assert/strict';
import test from 'node:test';
import { ambilPosisi, opsiAkurasiRendah, opsiAkurasiTinggi, opsiAwalLokasi, opsiSaatIzin, pesanLokasi } from '../public/js/lokasi.js';

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

function navPalsu({ state, onPosition }) {
  return {
    permissions: { query: async () => ({ state }) },
    geolocation: { getCurrentPosition: onPosition }
  };
}

test('izin ditolak meminta situs ini, bukan pesan GPS', async () => {
  let panggilan = 0;
  const nav = navPalsu({
    state: 'denied',
    onPosition() { panggilan += 1; }
  });
  await assert.rejects(ambilPosisi(nav), (error) => {
    assert.match(error.message, /Izinkan lokasi untuk situs ini/);
    assert.doesNotMatch(error.message, /GPS belum ketemu/);
    assert.doesNotMatch(error.message, /atau GPS/);
    return true;
  });
  assert.equal(panggilan, 0);
});

test('prompt membuka dialog dan menunggu jawaban', async () => {
  let sukses;
  const nav = navPalsu({
    state: 'prompt',
    onPosition(ok, _err, options) {
      assert.equal(options.enableHighAccuracy, true);
      assert.equal(options.timeout, opsiSaatIzin.timeout);
      sukses = ok;
    }
  });
  const janji = ambilPosisi(nav, { batasMs: 15 });
  await new Promise((resolve) => setTimeout(resolve, 40));
  let selesai = false;
  janji.then(() => { selesai = true; }, () => { selesai = true; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(selesai, false);
  sukses({ coords: { latitude: -6.175392, longitude: 106.827153, accuracy: 18 } });
  const titik = await janji;
  assert.deepEqual(titik, { lat: -6.175392, lng: 106.827153, accuracy: 18 });
});

test('timeout atau GPS kosong diulang sekali dengan posisi terakhir', async () => {
  for (const kode of [2, 3]) {
    const opsi = [];
    let ke = 0;
    const nav = navPalsu({
      state: 'granted',
      onPosition(ok, err, options) {
        opsi.push(options);
        ke += 1;
        if (ke === 1) {
          const error = new Error(kode === 3 ? 'Timeout expired' : 'Position unavailable');
          error.code = kode;
          err(error);
          return;
        }
        ok({ coords: { latitude: -6.2, longitude: 106.8, accuracy: 35 } });
      }
    });
    const titik = await ambilPosisi(nav);
    assert.equal(opsi[0].enableHighAccuracy, true);
    assert.equal(opsi[0].maximumAge, 0);
    assert.equal(opsi[1].enableHighAccuracy, false);
    assert.equal(opsi[1].maximumAge, 60000);
    assert.deepEqual(titik, { lat: -6.2, lng: 106.8, accuracy: 35 });
  }
});

test('permintaan yang menggantung dianggap timeout lalu diulang', async () => {
  let ke = 0;
  const nav = navPalsu({
    state: 'granted',
    onPosition(ok) {
      ke += 1;
      if (ke === 1) return;
      ok({ coords: { latitude: -6.125, longitude: 106.85, accuracy: 22 } });
    }
  });
  const titik = await ambilPosisi(nav, { batasMs: 30 });
  assert.equal(ke, 2);
  assert.deepEqual(titik, { lat: -6.125, lng: 106.85, accuracy: 22 });
});

test('kode ditolak dari browser tidak diulang sebagai GPS', async () => {
  let ke = 0;
  const nav = navPalsu({
    state: 'granted',
    onPosition(_ok, err) {
      ke += 1;
      const error = new Error('User denied Geolocation');
      error.code = 1;
      err(error);
    }
  });
  await assert.rejects(ambilPosisi(nav), (error) => {
    assert.match(error.message, /Izinkan lokasi untuk situs ini/);
    assert.doesNotMatch(error.message, /GPS belum ketemu/);
    return true;
  });
  assert.equal(ke, 1);
});
