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
