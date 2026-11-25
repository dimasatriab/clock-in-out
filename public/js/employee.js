import { api } from './api.js';
import { ensureModels, openCamera, stopStream, watchFace } from './face-capture.js';
import { durasi, esc, jam, jamPendek, sapaan, tanggalPanjang, tanggalPendek } from './format.js';
import { ambilPosisi, pesanLokasi } from './lokasi.js';

const layar = document.querySelector('#layar');
const kamera = document.querySelector('#kamera');
const video = document.querySelector('#video');
const tombolPin = document.querySelector('#kamera-pin');
const tombolStatus = document.querySelector('#kamera-riwayat');
const tombolAdmin = document.querySelector('#tautan-admin');
const teksStatus = document.querySelector('#kamera-status');
const teksLokasi = document.querySelector('#lokasi-depan');
const centangWajah = document.querySelector('#centang-wajah');
const centangLokasi = document.querySelector('#centang-lokasi');
let stream;
let cameraAbort;
let tick;
let layarToken = 0;
let lokasiUrut = 0;

const KODE_LOKASI = new Set(['gps_invalid', 'gps_inaccurate', 'outside_geofence', 'no_location']);
const KODE_WAJAH_GAGAL = new Set([
  'face_mismatch', 'face_not_enrolled', 'no_face', 'face_unknown', 'need_face',
  'multiple_faces', 'face_too_small', 'liveness_failed', 'not_frontal',
  'ambiguous_face', 'face_quality', 'bad_image', 'perlu_faktor', 'different_person'
]);

function gambarMasuk() {
  layar.innerHTML = `
    <header class="cap">
      <div>
        <div class="cap-nama">HA<span>DIR</span></div>
        <div class="garis"></div>
      </div>
      <div class="mini">WIB</div>
    </header>
    <p class="tanggal">${esc(tanggalPanjang())}</p>
    <section class="kartu">
      <h1 style="margin:0 0 8px;font-size:28px">Absen dari ponsel</h1>
      <p class="redup">Masuk dengan nomor HP dan PIN yang diberikan admin. Kamera depan dan lokasi wajib menyala.</p>
      <form id="masuk">
        <label for="telepon">Nomor HP</label>
        <input id="telepon" name="phone" inputmode="tel" autocomplete="username" placeholder="08xxxxxxxxxx" required>
        <label for="pin">PIN</label>
        <input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" minlength="4" maxlength="6" placeholder="4–6 angka" required>
        <p id="galat" class="pesan buruk" hidden></p>
        <button class="tombol" style="margin-top:16px" type="submit">Masuk</button>
      </form>
    </section>
    <p class="mini">Pasang seperti aplikasi: menu browser → Tambahkan ke Layar utama. Kamera hanya hidup lewat HTTPS.</p>`;
  layar.querySelector('#masuk').addEventListener('submit', async (event) => {
    event.preventDefault();
    const galat = layar.querySelector('#galat');
    galat.hidden = true;
    const data = new FormData(event.currentTarget);
    try {
      await api('/api/karyawan/masuk', { method: 'POST', body: { phone: data.get('phone'), pin: data.get('pin') } });
      await layarDepan();
    } catch (error) {
      galat.hidden = false;
      galat.textContent = error.message;
    }
  });
}

function lokasiTeks(hasil, error) {
  if (error) return error.message;
  if (!hasil) return 'Lokasi belum dicek.';
  if (hasil.everywhere) return `Everywhere. Akurasi ${Math.round(hasil.akurasi)} m.`;
  return `Di area ${hasil.lokasi.nama}. Jarak ke pusat ${hasil.jarakMeter} m, akurasi ${Math.round(hasil.akurasi)} m.`;
}

function lokasiSingkat(hasil) {
  if (!hasil) return 'Lokasi belum dicek.';
  if (hasil.everywhere) return 'Everywhere';
  return `Di area ${hasil.lokasi.nama}`;
}

async function izinLokasi() {
  try {
    if (!navigator.permissions?.query) return 'prompt';
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state || 'prompt';
  } catch {
    return 'prompt';
  }
}

async function posisi() {
  if (!window.isSecureContext) throw new Error(pesanLokasi({ code: 1, message: 'Only secure origins are allowed' }, false));
  return ambilPosisi(navigator);
}

async function tampilBeranda(pesanAwal) {
  const data = await api('/api/karyawan/saya');
  const terbuka = data.absenTerbuka;
  layar.innerHTML = `
    <header class="cap">
      <div>
        <div class="cap-nama">HA<span>DIR</span></div>
        <div class="garis"></div>
      </div>
      <div class="mini">${esc(data.karyawan.businessName)}${data.admin ? ' · <a class="tautan-halus" href="/admin">Admin</a>' : ''}</div>
    </header>
    <div class="jam" id="jam">${esc(jam())}</div>
    <p class="tanggal">${esc(tanggalPanjang())}</p>
    <section class="kartu">
      <div class="mini">${esc(sapaan())}</div>
      <h1 style="margin:4px 0 8px">${esc(data.karyawan.name)}</h1>
      <p>${terbuka ? `Sudah masuk pukul ${esc(jamPendek(terbuka.clockInAt))} di ${esc(terbuka.locationName)}.` : 'Belum absen masuk hari ini.'}</p>
      <p class="mini">${data.karyawan.shiftStart ? `Jadwal masuk ${esc(data.karyawan.shiftStart)} · toleransi ${esc(data.karyawan.graceMinutes)} menit` : 'Tidak ada jam masuk tetap.'}</p>
      <p class="mini">Wajah tersimpan: ${esc(data.karyawan.faceSampleCount)} foto. ${data.karyawan.faceSampleCount < 1 ? 'Minta admin mengambil foto depan.' : ''}</p>
      <div id="lokasi-status" class="pesan">Mengecek lokasi…</div>
      <button class="tombol" id="absen" type="button" style="margin-top:14px">${terbuka ? 'Clock Out' : 'Clock In'}</button>
      <button class="tombol-kedua" id="segar" type="button" style="margin-top:8px">Perbarui lokasi</button>
    </section>
    <section class="kartu">
      <h2 style="margin:0;font-size:18px">Riwayat singkat</h2>
      <div class="daftar" id="riwayat"></div>
    </section>
    <button class="keluar" id="keluar" type="button">Keluar</button>`;
  clearInterval(tick);
  tick = setInterval(() => {
    const el = document.querySelector('#jam');
    if (el) el.textContent = jam();
  }, 1000);
  const riwayat = await api('/api/karyawan/riwayat');
  layar.querySelector('#riwayat').innerHTML = riwayat.absensi.length
    ? riwayat.absensi.slice(0, 8).map((item) => `
      <div class="item">
        <div><strong>${esc(tanggalPendek(item.clockInAt))}</strong><div class="mini">${item.everywhere ? `Everywhere · ${esc(item.inLat)}, ${esc(item.inLng)}` : esc(item.locationName)}</div></div>
        <div>${esc(jamPendek(item.clockInAt))}–${esc(jamPendek(item.clockOutAt))}<div class="mini">${esc(durasi(item.hoursWorked))}</div></div>
      </div>`).join('')
    : '<p class="mini">Belum ada absensi.</p>';
  async function cek() {
    const kotak = layar.querySelector('#lokasi-status');
    try {
      const pos = await posisi();
      const hasil = await api(`/api/karyawan/cek-lokasi?lat=${pos.lat}&lng=${pos.lng}&akurasi=${pos.accuracy}`);
      kotak.className = 'pesan baik';
      kotak.textContent = lokasiTeks(hasil);
    } catch (error) {
      kotak.className = 'pesan';
      kotak.textContent = error.message;
    }
  }
  layar.querySelector('#segar').addEventListener('click', cek);
  layar.querySelector('#absen').addEventListener('click', () => layarDepan());
  layar.querySelector('#keluar').addEventListener('click', async () => {
    await api('/api/karyawan/keluar', { method: 'POST', body: {} });
    await layarDepan();
  });
  if (typeof pesanAwal === 'string') pesanAwal = { baik: true, teks: pesanAwal };
  if (pesanAwal?.teks) {
    const kotak = layar.querySelector('#lokasi-status');
    kotak.className = pesanAwal.baik === false ? 'pesan buruk' : 'pesan baik';
    kotak.textContent = pesanAwal.teks;
  } else {
    cek();
  }
  ensureModels().catch(() => {});
}

function masihLayar(token) {
  return token === layarToken;
}

function setCentang(el, keadaan, labelOk, labelTunggu) {
  if (!el) return;
  const ok = keadaan === 'ok';
  el.dataset.keadaan = ok ? 'ok' : 'tunggu';
  el.setAttribute('aria-label', ok ? labelOk : labelTunggu);
}

function setWajah(teks, keadaan) {
  if (teksStatus) teksStatus.textContent = teks;
  setCentang(centangWajah, keadaan, 'Wajah oke', 'Wajah menunggu');
}

function setLokasi(teks, keadaan) {
  if (teksLokasi) teksLokasi.textContent = teks;
  setCentang(centangLokasi, keadaan, 'Lokasi oke', 'Lokasi menunggu');
}

function tampilLokasi(teks, keadaan, urut) {
  if (urut !== lokasiUrut) return;
  setLokasi(teks, keadaan);
}

async function nilaiLokasi(titik, signal, token, urut) {
  try {
    const hasil = await api(`/api/karyawan/cek-lokasi?lat=${titik.lat}&lng=${titik.lng}&akurasi=${titik.accuracy}`);
    if (signal?.aborted || !masihLayar(token)) return hasil;
    tampilLokasi(lokasiSingkat(hasil), 'ok', urut);
    return hasil;
  } catch (error) {
    if (signal?.aborted || !masihLayar(token)) return null;
    tampilLokasi(error.message, 'tunggu', urut);
    return null;
  }
}

async function pantauLokasi(signal, token) {
  const urut = ++lokasiUrut;
  tampilLokasi('Mengecek lokasi…', 'tunggu', urut);
  try {
    const titik = await posisi();
    if (signal.aborted || !masihLayar(token) || urut !== lokasiUrut) return;
    await nilaiLokasi(titik, signal, token, urut);
  } catch (error) {
    if (signal.aborted || !masihLayar(token) || urut !== lokasiUrut) return;
    tampilLokasi(error.message, 'tunggu', urut);
  }
}

function gagalKenali(error) {
  if (KODE_LOKASI.has(error.code)) {
    setWajah('Wajah cocok', 'ok');
    const urut = ++lokasiUrut;
    tampilLokasi(error.message, 'tunggu', urut);
    return;
  }
  if (error.code === 'cooldown') {
    setWajah(error.message, 'ok');
    return;
  }
  setWajah(error.message, 'tunggu');
}

function gagalAbsen(error) {
  if (KODE_LOKASI.has(error.code)) {
    setWajah('Wajah cocok', 'ok');
    const urut = ++lokasiUrut;
    tampilLokasi(error.message, 'tunggu', urut);
    return;
  }
  if (KODE_WAJAH_GAGAL.has(error.code)) {
    setWajah(error.message, 'tunggu');
    return;
  }
  setWajah(error.message, 'ok');
}

function tunggu(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function gambarKotak(box) {
  const canvas = document.querySelector('#kotak-wajah');
  if (!canvas) return;
  const lebar = canvas.clientWidth || 240;
  const tinggi = canvas.clientHeight || 240;
  canvas.width = Math.round(lebar * 2);
  canvas.height = Math.round(tinggi * 2);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!box || !video.videoWidth) return;
  const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
  const ox = (canvas.width - video.videoWidth * scale) / 2;
  const oy = (canvas.height - video.videoHeight * scale) / 2;
  const x = canvas.width - (ox + (box.x + box.width) * scale);
  const y = oy + box.y * scale;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 4;
  ctx.strokeRect(x, y, box.width * scale, box.height * scale);
}

function ucapkan(teks, aktif) {
  if (!aktif || !window.speechSynthesis) return;
  const suara = new SpeechSynthesisUtterance(teks);
  suara.lang = 'id-ID';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(suara);
}

async function layarDepan() {
  const token = ++layarToken;
  cameraAbort?.abort();
  cameraAbort = new AbortController();
  const signal = cameraAbort.signal;
  layar.innerHTML = '';
  kamera.hidden = false;
  clearInterval(tick);
  setWajah('Menunggu wajah', 'tunggu');
  await periksaAdmin();
  pantauLokasi(signal, token);
  const pengaturanAwal = await api('/api/kiosk/pengaturan').catch(() => null);
  const merek = pengaturanAwal?.companyName || 'DBLESSMYRA';
  const judul = document.querySelector('#merek');
  if (judul) judul.textContent = merek;
  document.title = `${merek} — Attendance`;
  try {
    await ensureModels((teks) => {
      if (masihLayar(token) && !signal.aborted) setWajah(teks, 'tunggu');
    });
    if (!masihLayar(token) || signal.aborted) return;
    if (!stream) stream = await openCamera(video);
    if (!masihLayar(token) || signal.aborted) return;
    setWajah('Menunggu wajah', 'tunggu');
    await pindai(signal, token, pengaturanAwal);
  } catch (error) {
    if (!masihLayar(token) || signal.aborted || error.name === 'AbortError') return;
    setWajah(error.message || 'Kamera depan tidak siap.', 'tunggu');
  }
}

async function pindai(signal, token, awal) {
  const pengaturan = awal || await api('/api/kiosk/pengaturan').catch(() => ({
    audioAnnouncements: true
  }));
  while (!signal.aborted && masihLayar(token)) {
    gambarKotak(null);
    setWajah('Menunggu wajah', 'tunggu');
    const izinAwal = await izinLokasi();
    const titikJanji = izinAwal === 'granted' ? posisi() : null;
    let gerak;
    try {
      gerak = await watchFace(video, {
        signal,
        onBox: gambarKotak,
        onStatus(teks, fase) {
          if (signal.aborted || !masihLayar(token)) return;
          if (fase === 'ready') setWajah('Menunggu wajah', 'tunggu');
          else setWajah(teks, 'ok');
        }
      });
    } catch (error) {
      if (signal.aborted || error.name === 'AbortError' || !masihLayar(token)) return;
      setWajah(error.message, 'tunggu');
      await tunggu(1800, signal);
      continue;
    }
    if (signal.aborted || !masihLayar(token)) return;
    gambarKotak(null);
    setWajah('Mencocokkan wajah…', 'ok');
    let titik;
    try {
      if (titikJanji) {
        try {
          titik = await titikJanji;
        } catch {
          if (signal.aborted || !masihLayar(token)) return;
          titik = await posisi();
        }
      } else {
        titik = await posisi();
      }
    } catch (error) {
      if (signal.aborted || !masihLayar(token)) return;
      const urut = ++lokasiUrut;
      tampilLokasi(error.message, 'tunggu', urut);
      setWajah('Wajah terlihat', 'ok');
      await tunggu(1800, signal);
      continue;
    }
    if (signal.aborted || !masihLayar(token)) return;
    const urutLokasi = ++lokasiUrut;
    await nilaiLokasi(titik, signal, token, urutLokasi);
    if (signal.aborted || !masihLayar(token)) return;
    const form = new FormData();
    form.set('lat', String(titik.lat));
    form.set('lng', String(titik.lng));
    form.set('accuracy', String(titik.accuracy));
    gerak.frames.forEach((frame, index) => form.append('frame', frame.blob, `wajah-${index}.jpg`));
    let kenali;
    try {
      kenali = await api('/api/karyawan/kenali', { method: 'POST', form });
    } catch (error) {
      if (signal.aborted || !masihLayar(token)) return;
      gagalKenali(error);
      await tunggu(1800, signal);
      continue;
    }
    if (signal.aborted || !masihLayar(token)) return;
    setWajah('Wajah cocok', 'ok');
    if (centangLokasi?.dataset.keadaan !== 'ok') {
      const urut = ++lokasiUrut;
      tampilLokasi('Lokasi diterima', 'ok', urut);
    }
    const aksi = kenali.sesiTerbuka ? 'out' : 'in';
    form.set('action', aksi);
    form.set('token', kenali.token);
    setWajah(aksi === 'out' ? 'Mencatat clock out…' : 'Mencatat clock in…', 'ok');
    try {
      const hasil = await api('/api/karyawan/absen', { method: 'POST', form });
      if (signal.aborted || !masihLayar(token)) return;
      ucapkan(aksi === 'out' ? `Absen pulang, ${kenali.nama}` : `Absen masuk, ${kenali.nama}`, pengaturan.audioAnnouncements);
      const pesan = hasil.pesan;
      tutupKamera();
      try {
        await tampilBeranda({ baik: true, teks: pesan });
      } catch {
        gambarMasuk();
      }
      return;
    } catch (error) {
      if (signal.aborted || !masihLayar(token)) return;
      gagalAbsen(error);
      await tunggu(1800, signal);
    }
  }
}

function tutupKamera() {
  layarToken += 1;
  cameraAbort?.abort();
  stopStream(stream);
  stream = null;
  video.srcObject = null;
  kamera.hidden = true;
  clearInterval(tick);
}

tombolAdmin.addEventListener('click', () => {
  window.location.assign('/admin');
});

async function periksaAdmin() {
  try {
    await api('/api/admin/saya');
    tombolAdmin.hidden = false;
  } catch {
    tombolAdmin.hidden = true;
  }
}

tombolPin.addEventListener('click', () => {
  tutupKamera();
  gambarMasuk();
});

tombolStatus.addEventListener('click', async () => {
  tutupKamera();
  try {
    await tampilBeranda();
  } catch {
    gambarMasuk();
  }
});

ensureModels().catch(() => {});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

layarDepan();
