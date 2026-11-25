import { api } from './api.js';
import { ensureModels, openCamera, snapshot, stopStream, watchFace } from './face-capture.js';
import { durasi, esc, hariIniLabel, jamPendek, tanggalPendek } from './format.js';

const aplikasi = document.querySelector('#aplikasi');
const kamera = document.querySelector('#kamera');
const video = document.querySelector('#video');
const statusKamera = document.querySelector('#kamera-status');
let stream;
let peta;
let penanda;
let lingkaran;
let timer;

function konfirmasiHapus(judul, teks) {
  const dialog = document.querySelector('#konfirmasi-hapus');
  dialog.querySelector('#hapus-judul').textContent = judul;
  dialog.querySelector('#hapus-teks').textContent = teks;
  if (dialog.open) dialog.close();
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'hapus'), { once: true });
  });
}

async function hapusLokasi(id, nama) {
  let teks = 'Penugasan karyawan dilepas. Absensi lama tetap memakai nama lokasi ini.';
  try {
    const dampak = await api(`/api/admin/lokasi/${id}/dampak`);
    if (dampak.tanpaLokasi?.length) teks += ` ${dampak.tanpaLokasi.join(', ')} tidak akan punya lokasi kerja.`;
    nama = dampak.nama || nama;
  } catch (error) {
    alert(error.message);
    return;
  }
  if (!await konfirmasiHapus(`Hapus ${nama}?`, teks)) return;
  try {
    await api(`/api/admin/lokasi/${id}`, { method: 'DELETE' });
    await gambar();
  } catch (error) {
    alert(error.message);
  }
}

const state = {
  saya: null,
  bagian: 'hari',
  hari: null,
  karyawan: [],
  lokasi: [],
  absensi: [],
  rekap: [],
  pengaturan: null,
  notifikasi: [],
  belumBaca: 0,
  filter: { dari: '', sampai: '', karyawanId: '', lokasiId: '' }
};

let aliran;

function fotoTombol(item, fase) {
  const masuk = fase === 'masuk';
  const ada = masuk ? item.inPhoto : item.outPhoto;
  if (!ada) return '';
  const waktu = masuk ? item.clockInAt : item.clockOutAt;
  const jarak = masuk ? item.inFaceDistance : item.outFaceDistance;
  const lokasi = masuk ? barisLokasi(item) : (item.outLocationName || barisLokasi(item));
  const lat = masuk ? item.inLat : item.outLat;
  const lng = masuk ? item.inLng : item.outLng;
  const akurasi = masuk ? item.inAccuracy : item.outAccuracy;
  return `<button type="button" class="foto-tombol" data-id="${item.id}" data-fase="${fase}" data-nama="${esc(item.employeeName)}" data-waktu="${esc(jamPendek(waktu))}" data-tanggal="${esc(tanggalPendek(waktu))}" data-lokasi="${esc(lokasi)}" data-gps="${esc(lat)}, ${esc(lng)}" data-akurasi="${esc(akurasi)}" data-jarak="${esc(jarak)}"><img class="foto" alt="" src="/api/foto/absensi/${item.id}/${fase}"></button>`;
}

function bukaFoto(tombol) {
  const dialog = document.querySelector('#lihat-foto');
  const fase = tombol.dataset.fase === 'pulang' ? 'Pulang' : 'Masuk';
  document.querySelector('#lihat-gambar').src = `/api/foto/absensi/${tombol.dataset.id}/${tombol.dataset.fase}`;
  document.querySelector('#lihat-gambar').alt = `Swafoto ${fase} ${tombol.dataset.nama}`;
  document.querySelector('#lihat-judul').textContent = tombol.dataset.nama;
  document.querySelector('#lihat-teks').textContent = `${fase} · ${tombol.dataset.tanggal} ${tombol.dataset.waktu} WIB · ${tombol.dataset.lokasi} · GPS ${tombol.dataset.gps} · akurasi ${tombol.dataset.akurasi} m · jarak wajah ${tombol.dataset.jarak}`;
  dialog.showModal();
}

function kunciPush(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(`${base64}${pad}`.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function perbaruiLonceng() {
  const jumlah = document.querySelector('#lonceng-jumlah');
  if (!jumlah) return;
  jumlah.hidden = state.belumBaca < 1;
  jumlah.textContent = String(state.belumBaca);
}

function gambarNotifikasi() {
  const panel = document.querySelector('#lonceng-panel');
  if (!panel || panel.hidden) return;
  const daftar = state.notifikasi.map((item) => {
    const fase = item.action === 'out' ? 'pulang' : 'masuk';
    const kata = item.action === 'out' ? 'Pulang' : 'Masuk';
    return `<button type="button" class="notif-item foto-tombol" data-id="${item.attendanceId}" data-fase="${fase}" data-nama="${esc(item.employeeName)}" data-waktu="${esc(jamPendek(item.clockAt))}" data-tanggal="${esc(tanggalPendek(item.clockAt))}" data-lokasi="${esc(item.locationName)}" data-gps="${esc(item.lat)}, ${esc(item.lng)}" data-akurasi="${esc(item.accuracy)}" data-jarak="${esc(item.faceDistance)}"><img class="foto" alt="" src="/api/foto/absensi/${item.attendanceId}/${fase}"><span><strong>${esc(item.employeeName)}</strong><span class="mini">${kata} · ${esc(jamPendek(item.clockAt))} WIB</span></span></button>`;
  }).join('');
  panel.innerHTML = `${daftar || '<p class="mini">Belum ada absen.</p>'}<p class="mini" id="push-baris"></p>`;
  panel.querySelectorAll('.foto-tombol').forEach((tombol) => {
    tombol.addEventListener('click', () => bukaFoto(tombol));
  });
}

async function muatNotifikasi() {
  try {
    const data = await api('/api/admin/notifikasi');
    state.notifikasi = data.notifikasi;
    state.belumBaca = data.belumBaca;
  } catch { /* dasbor tetap jalan */ }
}

function mulaiAlur() {
  if (aliran || !window.EventSource) return;
  aliran = new EventSource('/api/admin/notifikasi/alur');
  aliran.onmessage = (event) => {
    if (!event.data) return;
    const item = JSON.parse(event.data);
    state.notifikasi = [item, ...state.notifikasi].slice(0, 30);
    state.belumBaca += 1;
    perbaruiLonceng();
    gambarNotifikasi();
  };
}

function masuk() {
  aplikasi.innerHTML = `
    <main class="kerangka">
      <div class="cap-nama">HA<span>DIR</span></div>
      <div class="garis"></div>
      <section class="kartu">
        <h1 style="margin-top:0">Dasbor admin</h1>
        <p class="redup">Kelola karyawan, lokasi kerja, dan rekap absensi.</p>
        <form id="masuk">
          <label for="telepon-admin">Nomor HP</label>
          <input id="telepon-admin" name="phone" inputmode="tel" autocomplete="username" placeholder="08xxxxxxxxxx" required>
          <label for="pin-admin">PIN</label>
          <input id="pin-admin" name="pin" type="password" inputmode="numeric" minlength="4" maxlength="6" autocomplete="current-password" placeholder="4–6 angka" required>
          <p id="galat" class="pesan buruk" hidden></p>
          <button class="tombol" style="margin-top:16px" type="submit">Masuk</button>
        </form>
      </section>
      <p class="mini"><a href="/">Halaman absen karyawan</a></p>
    </main>`;
  aplikasi.querySelector('#masuk').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await api('/api/admin/masuk', { method: 'POST', body: { phone: data.get('phone'), pin: data.get('pin') } });
      await buka();
    } catch (error) {
      const galat = aplikasi.querySelector('#galat');
      galat.hidden = false;
      galat.textContent = error.message;
    }
  });
}

function kerangka() {
  const menu = [
    ['hari', 'Hari ini'],
    ['karyawan', 'Karyawan'],
    ['lokasi', 'Lokasi'],
    ['riwayat', 'Riwayat'],
    ['rekap', 'Rekap'],
    ['pengaturan', 'Atur']
  ];
  aplikasi.innerHTML = `
    <div class="admin">
      <aside class="samping">
        <strong>${esc(state.saya.namaPerusahaan || 'DBLESSMYRA')}</strong>
        <div class="mini" style="margin-top:6px">${esc(state.saya.namaPengguna)}</div>
        <nav>
          ${menu.map(([id, label]) => `<button type="button" data-bagian="${id}" class="${state.bagian === id ? 'aktif' : ''}">${label}</button>`).join('')}
        </nav>
      </aside>
      <button class="lonceng" id="lonceng" type="button">Lonceng <span id="lonceng-jumlah" ${state.belumBaca ? '' : 'hidden'}>${state.belumBaca}</span></button>
      <div class="lonceng-panel" id="lonceng-panel" hidden></div>
      <main class="isi">
        <div class="isi-dalam" id="isi"></div>
      </main>
    </div>`;
  aplikasi.querySelectorAll('[data-bagian]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.bagian = button.dataset.bagian;
      await gambar();
    });
  });
}

function statusChip(orang) {
  if (orang.status === 'bekerja') return '<span class="chip ok">Sedang bekerja</span>';
  if (orang.status === 'pulang') return '<span class="chip">Sudah pulang</span>';
  return '<span class="chip">Belum hadir</span>';
}

function kelasBaris(orang) {
  if (!orang.record) return 'baris-absen';
  if (orang.flag === 'terlambat') return 'baris-telat';
  if (orang.flag === 'awal') return 'baris-awal';
  return 'baris-hadir';
}

function gambarHari() {
  if (state.saya?.perluGantiSandi || !state.hari) {
    return `<h1 style="margin-top:0">Dasbor</h1>
      <div class="peringatan"><strong>Ganti kata sandi awal sebelum memakai dasbor.</strong>
        <form id="ganti" class="baris" style="margin-top:8px">
          <input name="pin" type="password" inputmode="numeric" minlength="4" maxlength="6" placeholder="PIN baru" required>
          <button class="tombol" type="submit">Ganti</button>
        </form>
        <p id="sandi-pesan" class="mini"></p>
      </div>`;
  }
  const ringkas = state.hari.ringkasan;
  const puncak = Math.max(1, ...(state.hari.minggu || []).map((hari) => hari.jumlah));
  return `
    <h1 style="margin-top:0">Hari ini · ${esc(state.hari.tanggal)}</h1>
    <div class="statistik">
      ${[['Hadir', ringkas.hadir], ['Belum', ringkas.belum], ['Terlambat', ringkas.terlambat], ['Awal', ringkas.awal || 0]].map(([label, nilai]) => `
        <article class="kartu" style="margin:0"><div class="mini">${label}</div><div class="angka">${nilai}</div></article>`).join('')}
    </div>
    <p class="mini">Jam kerja selesai hari ini: ${esc(durasi(ringkas.jam || 0))}. Sesi yang belum ditutup tidak dihitung. <a href="/api/admin/ekspor.csv">Unduh CSV</a></p>
    <div class="tabel-bungkus">
      <table class="tabel">
        <thead><tr><th>Nama</th><th>Masuk</th><th>Pulang</th><th>Jam</th><th>Foto</th><th>Status</th></tr></thead>
        <tbody>
          ${state.hari.karyawan.map((orang) => `
            <tr class="${kelasBaris(orang)}">
              <td><strong>${esc(orang.employee.name)}</strong><div class="mini">${esc(orang.employee.businessName)}</div></td>
              <td>${esc(jamPendek(orang.sesi?.[0]?.clockInAt))}</td>
              <td>${esc(jamPendek(orang.record?.clockOutAt))}${orang.auto ? '<div class="mini">otomatis</div>' : ''}</td>
              <td>${esc(durasi(orang.jam || 0))}</td>
              <td>${orang.record ? `${fotoTombol(orang.record, 'masuk')}${fotoTombol(orang.record, 'pulang')}` : '—'}</td>
              <td>${statusChip(orang)} ${orang.late ? '<span class="chip warn">Terlambat</span>' : ''} ${orang.early ? '<span class="chip">Awal</span>' : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <h2>Jam per karyawan</h2>
    <div class="jam-daftar">
      ${state.hari.karyawan.map((orang) => `
        <article class="jam-orang">
          <div class="jam-baris">
            <strong>${esc(orang.employee.name)}</strong>
            <span>${esc(durasi(orang.jam || 0))}</span>
          </div>
          ${(orang.sesi || []).map((sesi) => `<div class="mini">${esc(jamPendek(sesi.clockInAt))}–${esc(jamPendek(sesi.clockOutAt))}${sesi.outAuto ? ' · otomatis' : ''}</div>`).join('')}
          ${orang.record && !orang.record.clockOutAt ? `<form data-tutup="${orang.record.id}" class="baris" style="margin-top:10px">
            <input type="datetime-local" name="clockOutAt">
            <button class="tombol" type="submit">Tutup sesi</button>
          </form>` : ''}
        </article>`).join('')}
    </div>
    <h2>Kehadiran 7 hari</h2>
    <div class="minggu">
      ${(state.hari.minggu || []).map((hari) => `
        <div class="kolom">
          <strong>${hari.jumlah}</strong>
          <div class="batang" style="height:${Math.max(8, Math.round((hari.jumlah / puncak) * 100))}px"></div>
          <span>${esc(hari.tanggal.slice(5))}</span>
        </div>`).join('')}
    </div>`;
}

function gambarPengaturan() {
  const atur = state.pengaturan || {};
  return `
    <h1 style="margin-top:0">Pengaturan</h1>
    <form id="pengaturan" class="kartu">
      <label>Nama perusahaan</label>
      <input name="companyName" maxlength="40" required value="${esc(atur.companyName || 'DBLESSMYRA')}">
      <label>Ambang jarak wajah (lebih kecil lebih ketat)</label>
      <input name="faceDistanceThreshold" type="number" min="0.2" max="0.8" step="0.01" value="${esc(atur.faceDistanceThreshold ?? 0.5)}" required>
      <label>Batas konfirmasi (detik)</label>
      <input name="confirmationTimeoutSeconds" type="number" min="3" max="60" value="${esc(atur.confirmationTimeoutSeconds ?? 10)}" required>
      <label>Jeda antar absen (detik)</label>
      <input name="detectionCooldownSeconds" type="number" min="0" max="300" value="${esc(atur.detectionCooldownSeconds ?? 30)}" required>
      <label>Jam pulang otomatis</label>
      <input name="autoClockOutTime" type="time" value="${esc(atur.autoClockOutTime || '20:00')}" required>
      <label>Batas terlambat</label>
      <input name="lateThreshold" type="time" step="1" value="${esc((atur.lateThreshold || '09:30:00').slice(0, 8))}" required>
      <label>Simpan foto absen (hari)</label>
      <input name="photoRetentionDays" type="number" min="1" max="3650" value="${esc(atur.photoRetentionDays ?? 90)}" required>
      <label class="cek"><input name="audioAnnouncements" type="checkbox" ${atur.audioAnnouncements === false ? '' : 'checked'}> Pengumuman suara</label>
      <button class="tombol" style="margin-top:12px" type="submit">Simpan pengaturan</button>
      <p id="atur-pesan" class="mini"></p>
    </form>
    <form id="ganti-pin" class="kartu">
      <h2 style="margin-top:0;font-size:18px">PIN admin</h2>
      <label for="pin-baru">PIN baru (4–6 angka)</label>
      <input id="pin-baru" name="pin" type="password" inputmode="numeric" minlength="4" maxlength="6" required>
      <button class="tombol" style="margin-top:12px" type="submit">Simpan PIN</button>
      <p id="pin-pesan" class="mini"></p>
    </form>
    <form id="impor" class="kartu">
      <h2 style="margin-top:0;font-size:18px">Impor absensi lama</h2>
      <p class="mini">CSV atau Excel dengan kolom nama, telepon, tanggal, masuk, pulang.</p>
      <input name="berkas" type="file" accept=".csv,.xls,.xlsx,text/csv" required>
      <button class="tombol" style="margin-top:12px" type="submit">Impor</button>
      <p id="impor-pesan" class="mini"></p>
    </form>`;
}

function gambarKaryawan() {
  return `
    <h1 style="margin-top:0">Karyawan</h1>
    <article class="kartu" id="form-karyawan">
      <h2 style="margin-top:0;font-size:18px">Tambah karyawan</h2>
      ${formKaryawan()}
    </article>
    <div class="karyawan-daftar">
      ${state.karyawan.map((orang) => `
        <article class="karyawan-kartu">
          <div class="jam-baris">
            <strong>${esc(orang.name)}</strong>
            ${orang.active ? '' : '<span class="chip bad">Nonaktif</span>'}
          </div>
          <div class="mini">${esc(orang.phone)} · ${esc(orang.businessName)} · ${esc(orang.shiftStart || 'bebas')}${orang.everywhere ? ' · Everywhere' : ''} · wajah ${orang.faceSampleCount}</div>
          <div class="karyawan-aksi">
            <button class="tombol-kedua" type="button" data-ubah="${orang.id}">Ubah</button>
            <button class="tombol" type="button" data-wajah="${orang.id}">Daftarkan wajah</button>
          </div>
        </article>`).join('')}
    </div>`;
}

function opsiUsaha(selected) {
  return state.usaha.map((usaha) => `<option value="${esc(usaha.id)}" ${usaha.id === selected ? 'selected' : ''}>${esc(usaha.name)}</option>`).join('');
}

function opsiLokasi(orang) {
  const selected = orang.locationIds || [];
  return `<div class="cek-daftar">
    <label class="cek"><input type="checkbox" name="everywhere" ${orang.everywhere ? 'checked' : ''}> Everywhere</label>
    <p class="mini">Boleh absen dari mana saja. Koordinat dan akurasi GPS tetap dicatat.</p>
    ${state.lokasi.map((lokasi) => `
    <label class="cek"><input type="checkbox" name="locationIds" value="${lokasi.id}" ${selected.includes(lokasi.id) ? 'checked' : ''}> ${esc(lokasi.name)}${lokasi.active ? '' : ' (nonaktif)'}</label>
  `).join('')}</div>`;
}

function formKaryawan(orang = {}) {
  return `
    <form data-karyawan="${orang.id || ''}">
      <label>Nama</label><input name="name" required value="${esc(orang.name || '')}">
      <label>Nomor HP</label><input name="phone" required value="${esc(orang.phone || '')}">
      <label>PIN ${orang.id ? '(kosongkan jika tidak diubah)' : ''}</label>
      <input name="pin" inputmode="numeric" minlength="4" maxlength="6" ${orang.id ? '' : 'required'}>
      <label>Usaha</label><select name="businessId">${opsiUsaha(orang.businessId || 'toko')}</select>
      <label>Jam masuk (opsional)</label><input name="shiftStart" type="time" value="${esc(orang.shiftStart || '')}">
      <label>Toleransi terlambat (menit)</label><input name="graceMinutes" type="number" min="0" max="180" value="${esc(orang.graceMinutes ?? 10)}">
      <label>Lokasi yang diizinkan</label>${opsiLokasi(orang)}
      <label class="cek"><input type="checkbox" name="active" ${orang.active === false ? '' : 'checked'}> Akun aktif</label>
      <p class="karyawan-pesan pesan buruk" hidden></p>
      <button class="tombol" style="margin-top:12px" type="submit">Simpan</button>
      ${orang.id ? `<button class="tombol-hapus" type="button" data-hapus-karyawan="${orang.id}">Hapus</button>` : ''}
    </form>`;
}

function gambarLokasi() {
  return `
    <h1 style="margin-top:0">Lokasi kerja</h1>
    <article class="kartu">
      <h2 style="margin-top:0;font-size:18px">Tambah atau ubah</h2>
      <form id="form-lokasi">
        <input type="hidden" name="id">
        <label>Nama</label><input name="name" required>
        <label>Usaha</label><select name="businessId">${opsiUsaha('toko')}</select>
        <div class="baris">
          <div><label>Lintang</label><input name="latitude" required inputmode="decimal"></div>
          <div><label>Bujur</label><input name="longitude" required inputmode="decimal"></div>
        </div>
        <label>Radius (meter)</label><input name="radiusMeters" type="number" min="30" max="2000" value="100" required>
        <label class="cek"><input name="active" type="checkbox" checked> Lokasi aktif</label>
        <div id="peta" class="peta"></div>
        <p class="mini">Ketuk peta untuk mengisi koordinat. Titik contoh di data awal bukan alamat sungguhan.</p>
        <button class="tombol" type="submit">Simpan lokasi</button>
        <button class="tombol-hapus" id="hapus-lokasi-form" type="button" hidden>Hapus</button>
      </form>
    </article>
    <div class="karyawan-daftar">
      ${state.lokasi.map((lokasi) => `
        <article class="karyawan-kartu">
          <div class="jam-baris">
            <strong>${esc(lokasi.name)}</strong>
            <span>${esc(lokasi.radiusMeters)} m</span>
          </div>
          <div class="mini">${esc(lokasi.businessName)} · ${Number(lokasi.latitude).toFixed(5)}, ${Number(lokasi.longitude).toFixed(5)}${lokasi.active ? '' : ' · nonaktif'}</div>
          <div class="karyawan-aksi">
            <button class="tombol-kedua" type="button" data-lokasi="${lokasi.id}">Isi formulir</button>
            <button class="tombol-bahaya" type="button" data-hapus-lokasi="${lokasi.id}">Hapus</button>
          </div>
        </article>`).join('')}
    </div>`;
}

function filterForm() {
  const dari = state.filter.dari || hariIniLabel(new Date(Date.now() - 6 * 86400000));
  const sampai = state.filter.sampai || hariIniLabel();
  return `
    <form id="filter" class="kartu">
      <div class="filter-grid">
        <div><label>Dari</label><input type="date" name="dari" value="${esc(dari)}"></div>
        <div><label>Sampai</label><input type="date" name="sampai" value="${esc(sampai)}"></div>
        <div>
          <label>Karyawan</label>
          <select name="karyawanId"><option value="">Semua</option>${state.karyawan.map((orang) => `<option value="${orang.id}" ${String(state.filter.karyawanId || '') === String(orang.id) ? 'selected' : ''}>${esc(orang.name)}</option>`).join('')}</select>
        </div>
        <div>
          <label>Lokasi</label>
          <select name="lokasiId"><option value="">Semua</option>${state.lokasi.map((lokasi) => `<option value="${lokasi.id}" ${String(state.filter.lokasiId || '') === String(lokasi.id) ? 'selected' : ''}>${esc(lokasi.name)}</option>`).join('')}</select>
        </div>
      </div>
      <button class="tombol" type="submit">Terapkan</button>
    </form>`;
}

function barisLokasi(item) {
  if (item.everywhere) return `Everywhere · ${item.inLat}, ${item.inLng} · akurasi ${item.inAccuracy} m`;
  return item.locationName;
}

function gambarRiwayat() {
  return `
    <h1 style="margin-top:0">Riwayat</h1>
    ${filterForm()}
    <p><a href="/api/admin/ekspor.csv?${queryFilter()}">Unduh CSV</a> · <a href="/api/admin/ekspor.xls?${queryFilter()}">Unduh Excel</a></p>
    <div class="daftar">
      ${state.absensi.map((item) => `
        <article class="kartu" style="margin:0">
          <div class="item" style="border:0;padding:0">
            <div>
              <strong>${esc(item.employeeName)}</strong>
              <div class="mini">${esc(tanggalPendek(item.clockInAt))} · ${esc(barisLokasi(item))}</div>
              <div class="mini">${esc(jamPendek(item.clockInAt))}–${esc(jamPendek(item.clockOutAt))} · ${esc(durasi(item.hoursWorked))}</div>
              <div class="mini">${item.lateMinutes > 0 ? `Terlambat ${item.lateMinutes} menit` : 'Tidak terlambat / tanpa jadwal'}</div>
              ${item.everywhere ? '' : `<div class="mini">GPS ${item.inLat}, ${item.inLng} · akurasi ${item.inAccuracy} m</div>`}
            </div>
            <div class="baris">${fotoTombol(item, 'masuk')}${fotoTombol(item, 'pulang')}</div>
          </div>
        </article>`).join('') || '<p>Tidak ada absensi pada rentang ini.</p>'}
    </div>`;
}

function gambarRekap() {
  return `
    <h1 class="judul-padat">Rekap</h1>
    ${filterForm()}
    <div class="rekap-daftar">
      ${state.rekap.map((baris) => `
        <article class="jam-orang">
          <div class="jam-baris">
            <strong>${esc(baris.name)}</strong>
            <span>${esc(durasi(baris.hours))}</span>
          </div>
          <div class="mini">${esc(baris.businessName)} · ${baris.days} hari · ${baris.shifts} absen · telat ${baris.lateCount}${baris.openShifts ? ` · ${baris.openShifts} belum pulang` : ''}</div>
        </article>`).join('') || '<p>Tidak ada rekap pada rentang ini.</p>'}
    </div>`;
}

function queryFilter() {
  const params = new URLSearchParams();
  if (state.filter.dari) params.set('dari', state.filter.dari);
  if (state.filter.sampai) params.set('sampai', state.filter.sampai);
  if (state.filter.karyawanId) params.set('karyawanId', state.filter.karyawanId);
  if (state.filter.lokasiId) params.set('lokasiId', state.filter.lokasiId);
  return params.toString();
}

async function muatBagian() {
  await muatNotifikasi();
  if (state.saya?.perluGantiSandi) return;
  if (state.bagian === 'hari') state.hari = await api('/api/admin/hari-ini');
  if (state.bagian === 'karyawan' || state.bagian === 'lokasi' || state.bagian === 'riwayat' || state.bagian === 'rekap') {
    const data = await api('/api/admin/karyawan');
    state.karyawan = data.karyawan;
    state.lokasi = data.lokasi;
  }
  if (state.bagian === 'riwayat') {
    const data = await api(`/api/admin/absensi?${queryFilter()}`);
    state.absensi = data.absensi;
    state.filter.dari = data.dari;
    state.filter.sampai = data.sampai;
  }
  if (state.bagian === 'rekap') {
    const data = await api(`/api/admin/rekap?${queryFilter()}`);
    state.rekap = data.rekap;
    state.filter.dari = data.dari;
    state.filter.sampai = data.sampai;
  }
  if (state.bagian === 'pengaturan') state.pengaturan = await api('/api/admin/pengaturan');
}

async function gambar() {
  clearInterval(timer);
  kerangka();
  await muatBagian();
  const isi = aplikasi.querySelector('#isi');
  if (state.bagian === 'hari') isi.innerHTML = gambarHari();
  if (state.bagian === 'karyawan') isi.innerHTML = gambarKaryawan();
  if (state.bagian === 'lokasi') isi.innerHTML = gambarLokasi();
  if (state.bagian === 'riwayat') isi.innerHTML = gambarRiwayat();
  if (state.bagian === 'rekap') isi.innerHTML = gambarRekap();
  if (state.bagian === 'pengaturan') isi.innerHTML = gambarPengaturan();
  pasangAksi(isi);
  pasangLonceng();
  perbaruiLonceng();
  mulaiAlur();
  if (state.bagian === 'hari') {
    timer = setInterval(async () => {
      state.hari = await api('/api/admin/hari-ini');
      const kotak = aplikasi.querySelector('#isi');
      if (kotak && state.bagian === 'hari') {
        kotak.innerHTML = gambarHari();
        pasangAksi(kotak);
      }
    }, 10000);
  }
  if (state.bagian === 'lokasi') siapkanPeta();
}

function pasangLonceng() {
  const tombol = document.querySelector('#lonceng');
  const panel = document.querySelector('#lonceng-panel');
  if (!tombol || !panel) return;
  tombol.addEventListener('click', async () => {
    panel.hidden = !panel.hidden;
    if (panel.hidden) return;
    gambarNotifikasi();
    if (state.belumBaca > 0) {
      await api('/api/admin/notifikasi/baca', { method: 'POST', body: {} }).catch(() => {});
      state.belumBaca = 0;
      perbaruiLonceng();
    }
    const push = await api('/api/admin/push').catch(() => null);
    const baris = panel.querySelector('#push-baris');
    if (baris && push?.aktif && window.Notification) {
      baris.innerHTML = '<button class="tombol-kedua" id="nyala-push" type="button">Nyalakan di ponsel ini</button>';
      panel.querySelector('#nyala-push').addEventListener('click', async () => {
        const izin = await Notification.requestPermission();
        if (izin !== 'granted') return;
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: kunciPush(push.kunci)
        });
        const json = sub.toJSON();
        await api('/api/admin/push', { method: 'POST', body: json });
        baris.textContent = 'Notifikasi ponsel menyala.';
      });
    }
  });
}

function pasangAksi(isi) {
  isi.querySelectorAll('.foto-tombol').forEach((tombol) => {
    tombol.addEventListener('click', () => bukaFoto(tombol));
  });
  isi.querySelector('#ganti')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const pin = new FormData(event.currentTarget).get('pin');
    try {
      const hasil = await api('/api/admin/pin', { method: 'POST', body: { pin } });
      state.saya.perluGantiSandi = false;
      await gambar();
    } catch (error) {
      isi.querySelector('#sandi-pesan').textContent = error.message;
    }
  });
  isi.querySelectorAll('form[data-karyawan]').forEach((form) => {
    const pesan = form.querySelector('.karyawan-pesan');
    const tampil = (teks) => {
      pesan.hidden = !teks;
      pesan.textContent = teks || '';
      if (teks) pesan.scrollIntoView({ block: 'nearest' });
    };
    form.querySelector('button[type="submit"]').addEventListener('click', (event) => {
      const kurang = [...form.elements].find((el) => el.willValidate && !el.checkValidity());
      if (!kurang) return;
      event.preventDefault();
      kurang.scrollIntoView({ block: 'center' });
      kurang.focus();
      tampil(kurang.validationMessage || 'Lengkapi data karyawan.');
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      tampil('');
      const data = new FormData(form);
      const everywhere = data.get('everywhere') === 'on';
      const active = data.get('active') === 'on';
      const locationIds = data.getAll('locationIds').map(Number).filter((id) => Number.isInteger(id) && id > 0);
      if (active && !everywhere && locationIds.length === 0) {
        tampil('Pilih Everywhere atau minimal satu lokasi.');
        form.querySelector('input[name="everywhere"]')?.scrollIntoView({ block: 'center' });
        return;
      }
      const body = {
        name: data.get('name'),
        phone: data.get('phone'),
        pin: data.get('pin'),
        businessId: data.get('businessId'),
        shiftStart: data.get('shiftStart'),
        graceMinutes: Number(data.get('graceMinutes')),
        locationIds,
        everywhere,
        active
      };
      const id = form.dataset.karyawan;
      const tombol = form.querySelector('button[type="submit"]');
      tombol.disabled = true;
      try {
        await api(id ? `/api/admin/karyawan/${id}` : '/api/admin/karyawan', { method: id ? 'PATCH' : 'POST', body });
        await gambar();
      } catch (error) {
        tombol.disabled = false;
        tampil(error.message);
      }
    });
  });
  isi.querySelectorAll('[data-hapus-karyawan]').forEach((button) => {
    button.addEventListener('click', async () => {
      const orang = state.karyawan.find((item) => item.id === Number(button.dataset.hapusKaryawan));
      const ya = await konfirmasiHapus(
        `Hapus ${orang?.name || 'karyawan ini'}?`,
        'Wajah dan sesi login ikut terhapus. Riwayat absensi tetap tersimpan dan ditandai dihapus.'
      );
      if (!ya) return;
      try {
        await api(`/api/admin/karyawan/${button.dataset.hapusKaryawan}`, { method: 'DELETE' });
        await gambar();
      } catch (error) {
        const pesan = button.form?.querySelector('.karyawan-pesan') || button.parentElement.querySelector('.karyawan-pesan');
        if (pesan) {
          pesan.hidden = false;
          pesan.textContent = error.message;
        } else {
          alert(error.message);
        }
      }
    });
  });
  isi.querySelectorAll('[data-ubah]').forEach((button) => {
    button.addEventListener('click', () => {
      const orang = state.karyawan.find((item) => item.id === Number(button.dataset.ubah));
      const kotak = isi.querySelector('#form-karyawan');
      kotak.innerHTML = `<h2 style="margin-top:0;font-size:18px">Ubah ${esc(orang.name)}</h2>${formKaryawan(orang)}`;
      pasangAksi(kotak);
    });
  });
  isi.querySelectorAll('[data-wajah]').forEach((button) => {
    button.addEventListener('click', () => daftarWajah(Number(button.dataset.wajah)));
  });
  isi.querySelector('#form-lokasi')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const id = data.get('id');
    const body = {
      name: data.get('name'),
      businessId: data.get('businessId'),
      latitude: Number(data.get('latitude')),
      longitude: Number(data.get('longitude')),
      radiusMeters: Number(data.get('radiusMeters')),
      active: data.get('active') === 'on'
    };
    try {
      await api(id ? `/api/admin/lokasi/${id}` : '/api/admin/lokasi', { method: id ? 'PATCH' : 'POST', body });
      await gambar();
    } catch (error) {
      alert(error.message);
    }
  });
  isi.querySelectorAll('[data-lokasi]').forEach((button) => {
    button.addEventListener('click', () => {
      const lokasi = state.lokasi.find((item) => item.id === Number(button.dataset.lokasi));
      const form = isi.querySelector('#form-lokasi');
      form.elements.id.value = lokasi.id;
      form.elements.name.value = lokasi.name;
      form.elements.businessId.value = lokasi.businessId;
      form.elements.latitude.value = lokasi.latitude;
      form.elements.longitude.value = lokasi.longitude;
      form.elements.radiusMeters.value = lokasi.radiusMeters;
      form.elements.active.checked = lokasi.active;
      const hapus = isi.querySelector('#hapus-lokasi-form');
      if (hapus) {
        hapus.hidden = false;
        hapus.dataset.id = String(lokasi.id);
        hapus.dataset.nama = lokasi.name;
      }
      gambarLingkaran();
    });
  });
  isi.querySelector('#hapus-lokasi-form')?.addEventListener('click', () => {
    const tombol = isi.querySelector('#hapus-lokasi-form');
    hapusLokasi(tombol.dataset.id, tombol.dataset.nama);
  });
  isi.querySelectorAll('[data-hapus-lokasi]').forEach((button) => {
    button.addEventListener('click', () => {
      const lokasi = state.lokasi.find((item) => item.id === Number(button.dataset.hapusLokasi));
      hapusLokasi(button.dataset.hapusLokasi, lokasi?.name || '');
    });
  });
  isi.querySelectorAll('form[data-tutup]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const clockOutAt = new FormData(form).get('clockOutAt');
      try {
        await api(`/api/admin/absensi/${form.dataset.tutup}/tutup`, { method: 'POST', body: { clockOutAt } });
        await gambar();
      } catch (error) {
        alert(error.message);
      }
    });
  });
  isi.querySelector('#ganti-pin')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const pin = new FormData(event.currentTarget).get('pin');
    try {
      const hasil = await api('/api/admin/pin', { method: 'POST', body: { pin } });
      event.currentTarget.reset();
      isi.querySelector('#pin-pesan').textContent = hasil.pesan;
    } catch (error) {
      isi.querySelector('#pin-pesan').textContent = error.message;
    }
  });
  isi.querySelector('#pengaturan')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const late = String(data.get('lateThreshold') || '09:30:00');
    const body = {
      companyName: data.get('companyName'),
      faceDistanceThreshold: Number(data.get('faceDistanceThreshold')),
      confirmationTimeoutSeconds: Number(data.get('confirmationTimeoutSeconds')),
      detectionCooldownSeconds: Number(data.get('detectionCooldownSeconds')),
      autoClockOutTime: data.get('autoClockOutTime'),
      lateThreshold: late.length === 5 ? `${late}:00` : late,
      photoRetentionDays: Number(data.get('photoRetentionDays')),
      audioAnnouncements: data.get('audioAnnouncements') === 'on'
    };
    try {
      const hasil = await api('/api/admin/pengaturan', { method: 'PUT', body });
      state.pengaturan = hasil;
      isi.querySelector('#atur-pesan').textContent = hasil.pesan;
    } catch (error) {
      isi.querySelector('#atur-pesan').textContent = error.message;
    }
  });
  isi.querySelector('#impor')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const hasil = await api('/api/admin/impor', { method: 'POST', form });
      isi.querySelector('#impor-pesan').textContent = hasil.pesan;
    } catch (error) {
      isi.querySelector('#impor-pesan').textContent = error.message;
    }
  });
  isi.querySelector('#filter')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    state.filter = {
      dari: data.get('dari'),
      sampai: data.get('sampai'),
      karyawanId: data.get('karyawanId'),
      lokasiId: data.get('lokasiId')
    };
    await gambar();
  });
}

function siapkanPeta() {
  const el = document.querySelector('#peta');
  if (!el || !window.L) return;
  peta = L.map(el).setView([-6.2, 106.845], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19
  }).addTo(peta);
  peta.on('click', (event) => {
    const form = document.querySelector('#form-lokasi');
    form.elements.latitude.value = event.latlng.lat.toFixed(6);
    form.elements.longitude.value = event.latlng.lng.toFixed(6);
    gambarLingkaran();
  });
  setTimeout(() => peta.invalidateSize(), 100);
}

function gambarLingkaran() {
  if (!peta) return;
  const form = document.querySelector('#form-lokasi');
  const lat = Number(form.elements.latitude.value);
  const lng = Number(form.elements.longitude.value);
  const radius = Number(form.elements.radiusMeters.value) || 100;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  if (penanda) penanda.remove();
  if (lingkaran) lingkaran.remove();
  penanda = L.marker([lat, lng]).addTo(peta);
  lingkaran = L.circle([lat, lng], { radius, color: '#0e6b5c' }).addTo(peta);
  peta.setView([lat, lng], 16);
}

function ambilDepan() {
  const cincin = document.querySelector('.cincin');
  const ambil = document.querySelector('#kamera-ambil');
  const batal = document.querySelector('#kamera-batal');
  const signal = new AbortController();
  return new Promise((resolve, reject) => {
    let selesai = false;
    const bersih = () => {
      signal.abort();
      ambil.removeEventListener('click', onAmbil);
      batal.removeEventListener('click', onBatal);
      cincin.classList.remove('siap');
    };
    const simpan = (blob) => {
      if (selesai || !blob) return;
      selesai = true;
      bersih();
      resolve([{ blob }]);
    };
    const onAmbil = async () => {
      statusKamera.textContent = 'Mengambil foto…';
      simpan(await snapshot(video));
    };
    const onBatal = () => {
      if (selesai) return;
      selesai = true;
      bersih();
      reject(new Error('Dibatalkan'));
    };
    ambil.addEventListener('click', onAmbil);
    batal.addEventListener('click', onBatal);
    watchFace(video, {
      signal: signal.signal,
      onStatus(teks) {
        if (!selesai) statusKamera.textContent = teks === 'Ready' ? 'Arahkan wajah ke kamera.' : teks;
      }
    }).then((hasil) => simpan(hasil.frames[0]?.blob)).catch((error) => {
      if (!selesai && error.name !== 'AbortError') {
        selesai = true;
        bersih();
        reject(error);
      }
    });
  });
}

async function daftarWajah(id) {
  const orang = state.karyawan.find((item) => item.id === id);
  const shots = [];
  kamera.hidden = false;
  try {
    statusKamera.textContent = 'Menyiapkan kamera…';
    await ensureModels((text) => { statusKamera.textContent = text; });
    stream = await openCamera(video);
    statusKamera.textContent = 'Arahkan wajah ke kamera.';
    const hasilFoto = await ambilDepan();
    shots.push(...hasilFoto);
    statusKamera.textContent = 'Menyimpan wajah…';
    const form = new FormData();
    shots.forEach((shot, index) => {
      form.append('foto', shot.blob, `daftar-${index}.jpg`);
    });
    const hasil = await api(`/api/admin/karyawan/${id}/wajah`, { method: 'POST', form });
    tutupKamera();
    alert(hasil.pesan);
    await gambar();
  } catch (error) {
    tutupKamera();
    if (error.message !== 'Dibatalkan') alert(`${orang.name}: ${error.message}`);
  }
}

function tutupKamera() {
  stopStream(stream);
  stream = null;
  video.srcObject = null;
  kamera.hidden = true;
}

document.querySelector('#kamera-batal').addEventListener('click', tutupKamera);
ensureModels().catch(() => {});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

async function buka() {
  state.saya = await api('/api/admin/saya');
  state.usaha = (await api('/api/usaha')).usaha;
  await gambar();
}

api('/api/admin/saya').then((saya) => {
  state.saya = saya;
  return api('/api/usaha');
}).then((data) => {
  state.usaha = data.usaha;
  return gambar();
}).catch(masuk);
