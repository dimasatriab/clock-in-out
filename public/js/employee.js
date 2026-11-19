import { api } from './api.js';
import { ensureModels, openCamera, stopStream, watchLiveness } from './face-capture.js';
import { durasi, esc, jam, jamPendek, sapaan, tanggalPanjang, tanggalPendek } from './format.js';

const layar = document.querySelector('#layar');
const kamera = document.querySelector('#kamera');
const video = document.querySelector('#video');
const tombolPin = document.querySelector('#kamera-pin');
const tombolStatus = document.querySelector('#kamera-riwayat');
const jamKamera = document.querySelector('#kamera-jam');
const lampu = document.querySelector('#lampu');
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
      <div class="mini">${esc(data.karyawan.businessName)}</div>
    </header>
    <div class="jam" id="jam">${esc(jam())}</div>
    <p class="tanggal">${esc(tanggalPanjang())}</p>
    <section class="kartu">
      <div class="mini">${esc(sapaan())}</div>
      <h1 style="margin:4px 0 8px">${esc(data.karyawan.name)}</h1>
      <p>${terbuka ? `Sudah masuk pukul ${esc(jamPendek(terbuka.clockInAt))} di ${esc(terbuka.locationName)}.` : 'Belum absen masuk hari ini.'}</p>
      <p class="mini">${data.karyawan.shiftStart ? `Jadwal masuk ${esc(data.karyawan.shiftStart)} · toleransi ${esc(data.karyawan.graceMinutes)} menit` : 'Tidak ada jam masuk tetap.'}</p>
      <p class="mini">Wajah tersimpan: ${esc(data.karyawan.faceSampleCount)} sampel. ${data.karyawan.faceSampleCount < 2 ? 'Minta admin mendaftarkan wajah dulu.' : ''}</p>
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
        <div><strong>${esc(tanggalPendek(item.clockInAt))}</strong><div class="mini">${esc(item.locationName)}</div></div>
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

function setLampu(siap) {
  lampu.className = siap ? 'lampu hijau' : 'lampu merah';
}

async function layarDepan() {
  const token = ++layarToken;
  cameraAbort?.abort();
  cameraAbort = new AbortController();
  const signal = cameraAbort.signal;
  layar.innerHTML = '';
  kamera.hidden = false;
  clearInterval(tick);
  jamKamera.textContent = jam();
  tick = setInterval(() => { jamKamera.textContent = jam(); }, 1000);
  setLampu(false);
  try {
    const pos = await posisi();
    if (!masihLayar(token) || signal.aborted) return;
    await ensureModels();
    if (!masihLayar(token) || signal.aborted) return;
    if (!stream) stream = await openCamera(video);
    if (!masihLayar(token)) return;
    setLampu(true);
    await pindai(pos, signal, token);
  } catch (error) {
    if (!masihLayar(token) || signal.aborted || error.name === 'AbortError') return;
    setLampu(false);
  }
}

async function pindai(pos, signal, token) {
  try {
    while (!signal.aborted && masihLayar(token)) {
      setLampu(true);
      const gerak = await watchLiveness(video, { signal });
      if (signal.aborted || !masihLayar(token)) return;
      const titik = await posisi().catch(() => null);
      if (!titik) {
        setLampu(false);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      const form = new FormData();
      form.set('lat', String(titik.lat));
      form.set('lng', String(titik.lng));
      form.set('accuracy', String(titik.accuracy));
      gerak.frames.forEach((frame, index) => form.append('frame', frame.blob, `wajah-${index}.jpg`));
      try {
        await api('/api/karyawan/kenali', { method: 'POST', form });
        setLampu(true);
      } catch {
        setLampu(false);
      }
      await new Promise((resolve) => setTimeout(resolve, 1800));
    }
  } catch (error) {
    if (signal.aborted || error.name === 'AbortError') return;
    setLampu(false);
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
