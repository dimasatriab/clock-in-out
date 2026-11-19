import { api } from './api.js';
import { capturePose, ensureModels, openCamera, stopStream } from './face-capture.js';
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

const state = {
  saya: null,
  bagian: 'hari',
  hari: null,
  karyawan: [],
  lokasi: [],
  absensi: [],
  rekap: [],
  pengaturan: null,
  filter: { dari: '', sampai: '', karyawanId: '', lokasiId: '' }
};

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
      <main class="isi">
        <div class="bar-atas"><button id="keluar" type="button">Keluar</button></div>
        <div class="isi-dalam" id="isi"></div>
      </main>
    </div>`;
  aplikasi.querySelectorAll('[data-bagian]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.bagian = button.dataset.bagian;
      await gambar();
    });
  });
  aplikasi.querySelector('#keluar').addEventListener('click', async () => {
    clearInterval(timer);
    await api('/api/admin/keluar', { method: 'POST', body: {} });
    state.saya = null;
    masuk();
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
        <thead><tr><th>Nama</th><th>Masuk</th><th>Pulang</th><th>Jam</th><th>Status</th></tr></thead>
        <tbody>
          ${state.hari.karyawan.map((orang) => `
            <tr class="${kelasBaris(orang)}">
              <td><strong>${esc(orang.employee.name)}</strong><div class="mini">${esc(orang.employee.businessName)}</div></td>
              <td>${esc(jamPendek(orang.sesi?.[0]?.clockInAt))}</td>
              <td>${esc(jamPendek(orang.record?.clockOutAt))}${orang.auto ? '<div class="mini">otomatis</div>' : ''}</td>
              <td>${esc(durasi(orang.jam || 0))}</td>
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
      <label>Lewati frame (frame skip)</label>
      <input name="frameSkip" type="number" min="1" max="10" value="${esc(atur.frameSkip ?? 3)}" required>
      <label>Batas konfirmasi (detik)</label>
      <input name="confirmationTimeoutSeconds" type="number" min="3" max="60" value="${esc(atur.confirmationTimeoutSeconds ?? 10)}" required>
      <label>Jeda antar absen (detik)</label>
      <input name="detectionCooldownSeconds" type="number" min="0" max="300" value="${esc(atur.detectionCooldownSeconds ?? 30)}" required>
      <label>Ketajaman minimum</label>
      <input name="sharpnessMin" type="number" min="0" max="500" value="${esc(atur.sharpnessMin ?? 50)}" required>
      <label>Jam pulang otomatis</label>
      <input name="autoClockOutTime" type="time" value="${esc(atur.autoClockOutTime || '20:00')}" required>
      <label>Batas terlambat</label>
      <input name="lateThreshold" type="time" step="1" value="${esc((atur.lateThreshold || '09:30:00').slice(0, 8))}" required>
      <label>Maksimum foto pendaftaran</label>
      <input name="maxEnrollmentFrames" type="number" min="5" max="40" value="${esc(atur.maxEnrollmentFrames ?? 12)}" required>
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
          <div class="mini">${esc(orang.phone)} · ${esc(orang.businessName)} · ${esc(orang.shiftStart || 'bebas')} · wajah ${orang.faceSampleCount}</div>
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

function opsiLokasi(selected) {
  return `<div class="cek-daftar">${state.lokasi.map((lokasi) => `
    <label class="cek"><input type="checkbox" name="locationIds" value="${lokasi.id}" ${selected.includes(lokasi.id) ? 'checked' : ''}> ${esc(lokasi.name)}</label>
  `).join('')}</div>`;
}

function formKaryawan(orang = {}) {
  const lokasi = orang.locationIds || [];
  return `
    <form data-karyawan="${orang.id || ''}">
      <label>Nama</label><input name="name" required value="${esc(orang.name || '')}">
      <label>Nomor HP</label><input name="phone" required value="${esc(orang.phone || '')}">
      <label>PIN ${orang.id ? '(kosongkan jika tidak diubah)' : ''}</label>
      <input name="pin" inputmode="numeric" minlength="4" maxlength="6" ${orang.id ? '' : 'required'}>
      <label>Usaha</label><select name="businessId">${opsiUsaha(orang.businessId || 'toko')}</select>
      <label>Jam masuk (opsional)</label><input name="shiftStart" type="time" value="${esc(orang.shiftStart || '')}">
      <label>Toleransi terlambat (menit)</label><input name="graceMinutes" type="number" min="0" max="180" value="${esc(orang.graceMinutes ?? 10)}">
      <label>Lokasi yang diizinkan</label>${opsiLokasi(lokasi)}
      <label class="cek"><input type="checkbox" name="active" ${orang.active === false ? '' : 'checked'}> Akun aktif</label>
      <button class="tombol" style="margin-top:12px" type="submit">Simpan</button>
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
              <div class="mini">${esc(tanggalPendek(item.clockInAt))} · ${esc(item.locationName)}</div>
              <div class="mini">${esc(jamPendek(item.clockInAt))}–${esc(jamPendek(item.clockOutAt))} · ${esc(durasi(item.hoursWorked))}</div>
              <div class="mini">${item.lateMinutes > 0 ? `Terlambat ${item.lateMinutes} menit` : 'Tidak terlambat / tanpa jadwal'}</div>
              <div class="mini">GPS ${item.inLat}, ${item.inLng} · akurasi ${item.inAccuracy} m</div>
            </div>
            <img class="foto" alt="Swafoto masuk ${esc(item.employeeName)}" src="/api/foto/absensi/${item.id}/masuk">
          </div>
        </article>`).join('') || '<p>Tidak ada absensi pada rentang ini.</p>'}
    </div>`;
}

function gambarRekap() {
  return `
    <h1 style="margin-top:0">Rekap</h1>
    ${filterForm()}
    <div class="daftar">
      ${state.rekap.map((baris) => `
        <article class="kartu" style="margin:0">
          <strong>${esc(baris.name)}</strong>
          <div class="mini">${esc(baris.businessName)} · ${baris.days} hari · ${baris.shifts} absen · terlambat ${baris.lateCount} kali (${baris.lateMinutes} menit)</div>
          <div class="mini">Jam kerja tercatat ${esc(durasi(baris.hours))}${baris.openShifts ? ` · ${baris.openShifts} belum pulang` : ''}</div>
        </article>`).join('')}
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

function pasangAksi(isi) {
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
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const body = {
        name: data.get('name'),
        phone: data.get('phone'),
        pin: data.get('pin'),
        businessId: data.get('businessId'),
        shiftStart: data.get('shiftStart'),
        graceMinutes: Number(data.get('graceMinutes')),
        locationIds: data.getAll('locationIds').map(Number),
        active: data.get('active') === 'on'
      };
      const id = form.dataset.karyawan;
      try {
        await api(id ? `/api/admin/karyawan/${id}` : '/api/admin/karyawan', { method: id ? 'PATCH' : 'POST', body });
        await gambar();
      } catch (error) {
        alert(error.message);
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
      gambarLingkaran();
    });
  });
  isi.querySelectorAll('[data-hapus-lokasi]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Hapus lokasi ini? Lokasi yang sudah punya absensi hanya bisa dinonaktifkan.')) return;
      try {
        await api(`/api/admin/lokasi/${button.dataset.hapusLokasi}`, { method: 'DELETE' });
        await gambar();
      } catch (error) {
        alert(error.message);
      }
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
      frameSkip: Number(data.get('frameSkip')),
      confirmationTimeoutSeconds: Number(data.get('confirmationTimeoutSeconds')),
      detectionCooldownSeconds: Number(data.get('detectionCooldownSeconds')),
      sharpnessMin: Number(data.get('sharpnessMin')),
      autoClockOutTime: data.get('autoClockOutTime'),
      lateThreshold: late.length === 5 ? `${late}:00` : late,
      maxEnrollmentFrames: Number(data.get('maxEnrollmentFrames')),
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

const POSE_DAFTAR = [
  ['lurus', 'Hadap lurus ke kamera.'],
  ['kiri', 'Menoleh ke kiri.'],
  ['kanan', 'Menoleh ke kanan.'],
  ['atas', 'Angkat dagu, lihat sedikit ke atas.'],
  ['bawah', 'Tundukkan dagu sedikit.']
];

function poseCukup(nama, pose) {
  const yaw = pose.yaw;
  const pitch = pose.pitch;
  if ((pose.score ?? 1) < 0.45) return 'Wajah kurang jelas.';
  if ((pose.sharpness ?? 999) < 50) return 'Foto terlalu datar. Jangan memakai cetakan.';
  if ((pose.box?.width ?? 200) < 80) return 'Dekatkan wajah.';
  if (nama === 'lurus' && (Math.abs(yaw) > 0.22 || Math.abs(pitch) > 0.2)) return 'Hadap lebih lurus.';
  if (nama === 'kiri' && yaw > -0.1) return 'Menoleh lebih ke kiri.';
  if (nama === 'kanan' && yaw < 0.1) return 'Menoleh lebih ke kanan.';
  if (nama === 'atas' && pitch > -0.06) return 'Angkat dagu sedikit lagi.';
  if (nama === 'bawah' && pitch < 0.06) return 'Tundukkan dagu sedikit lagi.';
  return '';
}

async function daftarWajah(id) {
  const orang = state.karyawan.find((item) => item.id === id);
  const shots = [];
  kamera.hidden = false;
  try {
    statusKamera.textContent = 'Menyiapkan kamera…';
    await ensureModels((text) => { statusKamera.textContent = text; });
    stream = await openCamera(video);
    for (let i = 0; i < POSE_DAFTAR.length; i += 1) {
      const [nama, petunjuk] = POSE_DAFTAR[i];
      statusKamera.textContent = `${i + 1}/${POSE_DAFTAR.length}. ${petunjuk}`;
      const shot = await new Promise((resolve, reject) => {
        const ambil = document.querySelector('#kamera-ambil');
        const onAmbil = async () => {
          const pose = await capturePose(video);
          if (!pose) {
            statusKamera.textContent = `${i + 1}/${POSE_DAFTAR.length}. ${petunjuk} Wajah belum terlihat.`;
            return;
          }
          const alasan = poseCukup(nama, pose);
          if (alasan) {
            statusKamera.textContent = `${i + 1}/${POSE_DAFTAR.length}. ${alasan}`;
            return;
          }
          ambil.removeEventListener('click', onAmbil);
          resolve({ ...pose, pose: nama });
        };
        ambil.addEventListener('click', onAmbil);
        document.querySelector('#kamera-batal').addEventListener('click', () => reject(new Error('Dibatalkan')), { once: true });
      });
      shots.push(shot);
    }
    statusKamera.textContent = 'Menyimpan wajah…';
    const form = new FormData();
    shots.forEach((shot, index) => {
      form.append('pose', shot.pose);
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
