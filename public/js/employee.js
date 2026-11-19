import { api } from './api.js';
import { ensureModels, openCamera, stopStream, watchFace } from './face-capture.js';
import { durasi, esc, jam, jamPendek, sapaan, tanggalPanjang, tanggalPendek } from './format.js';

const layar = document.querySelector('#layar');
const kamera = document.querySelector('#kamera');
const video = document.querySelector('#video');
const tombolPin = document.querySelector('#kamera-pin');
const tombolStatus = document.querySelector('#kamera-riwayat');
const tombolAdmin = document.querySelector('#tautan-admin');
const lampu = document.querySelector('#lampu');
const teksStatus = document.querySelector('#kamera-status');
let stream;
let cameraAbort;
let tick;
let layarToken = 0;

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
        <input id="pin" name="pin" inputmode="numeric" autocomplete="current-password" minlength="4" maxlength="6" placeholder="4–6 angka" required>
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

async function posisi() {
  if (!navigator.geolocation) throw new Error('Ponsel ini tidak menyediakan GPS.');
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => reject(new Error('Izin lokasi ditolak atau GPS belum ketemu. Nyalakan lokasi, lalu coba lagi.')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
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
      <button class="tombol" id="absen" type="button" style="margin-top:14px">Kembali ke kamera</button>
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
  if (pesanAwal) {
    const kotak = layar.querySelector('#lokasi-status');
    kotak.className = pesanAwal.baik ? 'pesan baik' : 'pesan buruk';
    kotak.textContent = pesanAwal.teks;
  } else {
    cek();
  }
  ensureModels().catch(() => {});
}

function masihLayar(token) {
  return token === layarToken;
}

function setStatus(teks, fase) {
  if (teksStatus) teksStatus.textContent = teks;
  const kelas = { ready: 'siap', scanning: 'pindai', error: 'gagal', success: 'berhasil' }[fase] || 'siap';
  if (lampu) lampu.className = `titik ${kelas}`;
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
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, box.width * scale, box.height * scale);
}

function ucapkan(teks, aktif) {
  if (!aktif || !window.speechSynthesis) return;
  const suara = new SpeechSynthesisUtterance(teks);
  suara.lang = 'id-ID';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(suara);
}

function tungguPilihan(nama, detik, signal) {
  const panel = document.querySelector('#konfirmasi');
  const hitung = document.querySelector('#konfirmasi-hitung');
  const masukBtn = document.querySelector('#konfirmasi-masuk');
  const pulangBtn = document.querySelector('#konfirmasi-pulang');
  document.querySelector('#konfirmasi-nama').textContent = nama;
  panel.hidden = false;
  kamera.classList.add('sedang-konfirmasi');
  setStatus('Confirming', 'scanning');
  let sisa = detik;
  hitung.textContent = `${sisa}s`;
  return new Promise((resolve) => {
    const selesai = (nilai) => {
      clearInterval(timer);
      masukBtn.removeEventListener('click', pilihMasuk);
      pulangBtn.removeEventListener('click', pilihPulang);
      signal?.removeEventListener('abort', batal);
      panel.hidden = true;
      kamera.classList.remove('sedang-konfirmasi');
      resolve(nilai);
    };
    const pilihMasuk = () => selesai('in');
    const pilihPulang = () => selesai('out');
    const batal = () => selesai('abort');
    const timer = setInterval(() => {
      sisa -= 1;
      hitung.textContent = `${Math.max(sisa, 0)}s`;
      if (sisa <= 0) selesai('timeout');
    }, 1000);
    masukBtn.addEventListener('click', pilihMasuk);
    pulangBtn.addEventListener('click', pilihPulang);
    signal?.addEventListener('abort', batal);
  });
}

function tampilPita(aksi, nama, waktu) {
  const pita = document.querySelector('#pita');
  pita.hidden = false;
  pita.className = `pita ${aksi === 'out' ? 'pulang' : 'masuk'}`;
  const kata = aksi === 'out' ? 'Clock Out' : 'Clock In';
  pita.textContent = `${kata} Confirmed — ${nama} | ${waktu}`;
}

async function layarDepan() {
  const token = ++layarToken;
  cameraAbort?.abort();
  cameraAbort = new AbortController();
  const signal = cameraAbort.signal;
  layar.innerHTML = '';
  kamera.hidden = false;
  clearInterval(tick);
  setStatus('Ready', 'ready');
  await periksaAdmin();
  posisi().catch(() => {});
  const pengaturanAwal = await api('/api/kiosk/pengaturan').catch(() => null);
  const merek = pengaturanAwal?.companyName || 'DBLESSMYRA';
  const judul = document.querySelector('#merek');
  if (judul) judul.textContent = merek;
  document.title = `${merek} — Attendance`;
  try {
    await ensureModels((teks) => {
      if (masihLayar(token) && !signal.aborted) setStatus(teks, 'scanning');
    });
    if (!masihLayar(token) || signal.aborted) return;
    if (!stream) stream = await openCamera(video);
    if (!masihLayar(token) || signal.aborted) return;
    setStatus('Ready', 'ready');
    await pindai(signal, token, pengaturanAwal);
  } catch (error) {
    if (!masihLayar(token) || signal.aborted || error.name === 'AbortError') return;
    setStatus(error.message || 'Kamera depan tidak siap.', 'error');
  }
}

async function pindai(signal, token, awal) {
  const pengaturan = awal || await api('/api/kiosk/pengaturan').catch(() => ({
    frameSkip: 3,
    confirmationTimeoutSeconds: 10,
    audioAnnouncements: true
  }));
  while (!signal.aborted && masihLayar(token)) {
    gambarKotak(null);
    setStatus('Ready', 'ready');
    let gerak;
    try {
      gerak = await watchFace(video, {
        signal,
        onBox: gambarKotak,
        onStatus(teks, fase) {
          if (signal.aborted || !masihLayar(token)) return;
          if (fase === 'ready') setStatus('Ready', 'ready');
          else setStatus(teks, 'scanning');
        }
      });
    } catch (error) {
      if (signal.aborted || error.name === 'AbortError' || !masihLayar(token)) return;
      setStatus(error.message, 'error');
      await tunggu(1800, signal);
      continue;
    }
    if (signal.aborted || !masihLayar(token)) return;
    gambarKotak(null);
    setStatus('Mencocokkan wajah…', 'scanning');
    let titik;
    try {
      titik = await posisi();
    } catch (error) {
      if (signal.aborted || !masihLayar(token)) return;
      setStatus(error.message, 'error');
      await tunggu(1800, signal);
      continue;
    }
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
      setStatus(error.message, 'error');
      await tunggu(1800, signal);
      continue;
    }
    if (signal.aborted || !masihLayar(token)) return;
    const pilihan = await tungguPilihan(kenali.nama, pengaturan.confirmationTimeoutSeconds || 10, signal);
    if (pilihan === 'abort') return;
    if (pilihan === 'timeout') {
      setStatus('Ready', 'ready');
      continue;
    }
    form.set('action', pilihan);
    form.set('token', kenali.token);
    try {
      const hasil = await api('/api/karyawan/absen', { method: 'POST', form });
      const saat = jamPendek(pilihan === 'out' ? hasil.absensi?.clockOutAt : hasil.absensi?.clockInAt);
      tampilPita(pilihan, kenali.nama, saat);
      setStatus(pilihan === 'out' ? 'Clock Out' : 'Clock In', 'success');
      ucapkan(pilihan === 'out' ? `Absen pulang dikonfirmasi, ${kenali.nama}` : `Absen masuk dikonfirmasi, ${kenali.nama}`, pengaturan.audioAnnouncements);
      await tunggu(2000, signal);
    } catch (error) {
      if (signal.aborted || !masihLayar(token)) return;
      setStatus(error.message, 'error');
      await tunggu(1800, signal);
    }
    const pita = document.querySelector('#pita');
    if (pita) pita.hidden = true;
    if (signal.aborted || !masihLayar(token)) return;
    setStatus('Ready', 'ready');
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

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

layarDepan();
