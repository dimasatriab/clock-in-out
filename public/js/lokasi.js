export const opsiAkurasiTinggi = { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 };
export const opsiAkurasiRendah = { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 };
export const opsiSaatIzin = { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 };

export function pesanLokasi(error, aman = true) {
  const kode = Number(error?.code);
  const asli = String(error?.message || '');
  if (!aman || /secure origin/i.test(asli)) {
    return 'Browser menolak lokasi karena halaman ini bukan HTTPS. Buka lewat HTTPS, lalu izinkan lokasi.';
  }
  if (kode === 1) return 'Izin lokasi ditolak. Izinkan lokasi untuk situs ini di pengaturan browser, lalu coba lagi.';
  if (kode === 2) return 'GPS belum ketemu. Nyalakan lokasi di ponsel, lalu coba lagi.';
  if (kode === 3) return 'GPS terlalu lama menjawab. Coba lagi di tempat yang lebih terbuka.';
  return 'Lokasi tidak tersedia. Nyalakan GPS, lalu coba lagi.';
}

export function opsiAwalLokasi(izin) {
  return izin === 'prompt' ? opsiSaatIzin : opsiAkurasiTinggi;
}

async function statusIzin(nav) {
  try {
    if (!nav.permissions?.query) return 'unknown';
    const status = await nav.permissions.query({ name: 'geolocation' });
    return status?.state || 'unknown';
  } catch {
    return 'unknown';
  }
}

function mintaTitik(geo, opsi, batasMs) {
  return new Promise((resolve, reject) => {
    let selesai = false;
    const timer = batasMs > 0 ? setTimeout(() => {
      if (selesai) return;
      selesai = true;
      const error = new Error('Timeout expired');
      error.code = 3;
      reject(error);
    }, batasMs) : null;
    const beres = (gagal, nilai) => {
      if (selesai) return;
      selesai = true;
      if (timer) clearTimeout(timer);
      if (gagal) reject(nilai);
      else resolve(nilai);
    };
    try {
      geo.getCurrentPosition(
        (pos) => {
          const lat = Number(pos?.coords?.latitude);
          const lng = Number(pos?.coords?.longitude);
          const accuracy = Number(pos?.coords?.accuracy);
          if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(accuracy)) {
            const error = new Error('Position unavailable');
            error.code = 2;
            beres(true, error);
            return;
          }
          beres(false, { lat, lng, accuracy });
        },
        (error) => beres(true, error),
        opsi
      );
    } catch (error) {
      beres(true, error);
    }
  });
}

export async function ambilPosisi(nav, uji = {}) {
  if (!nav?.geolocation?.getCurrentPosition) throw new Error('Ponsel ini tidak menyediakan GPS.');
  let izin = await statusIzin(nav);
  if (izin === 'denied') throw new Error(pesanLokasi({ code: 1 }, true));
  const batas = (opsi, state) => (state === 'prompt' ? 0 : (uji.batasMs ?? opsi.timeout + 500));
  const awal = opsiAwalLokasi(izin);
  try {
    return await mintaTitik(nav.geolocation, awal, batas(awal, izin));
  } catch (error) {
    if (Number(error?.code) === 1) throw new Error(pesanLokasi(error, true));
    izin = await statusIzin(nav);
    if (izin === 'denied') throw new Error(pesanLokasi({ code: 1 }, true));
    try {
      return await mintaTitik(nav.geolocation, opsiAkurasiRendah, batas(opsiAkurasiRendah, izin));
    } catch (ulang) {
      if (Number(ulang?.code) === 1) throw new Error(pesanLokasi(ulang, true));
      throw new Error(pesanLokasi(ulang, true));
    }
  }
}
