# Hadir

Absensi karyawan untuk toko, unit sewa, dan rumah. Karyawan absen dari browser ponsel (bisa dipasang seperti aplikasi). Setiap absen memakai kamera depan, pemeriksaan wajah, dan lokasi GPS. Semua jam dicatat dalam **WIB (Asia/Jakarta)**.

Teks antarmuka berbahasa Indonesia. Tiga kelompok usaha: **Toko DBLESS MYRA**, **Unit hostbydims**, dan **Rumah**.

## Coba di komputer

Perlu Node.js 22.

```bash
cp .env.example .env
npm install
npm test
npm start
```

Buka <http://localhost:3000> untuk karyawan dan <http://localhost:3000/admin> untuk admin. `localhost` sudah aman untuk kamera. Alamat IP seperti `http://192.168.x.x` tidak diizinkan browser untuk kamera dan GPS.

## Akun

Tidak ada nomor HP atau PIN bawaan di repo. Di `.env`, isi `ADMIN_PHONE` dan `ADMIN_PIN` (4–6 angka). Server production menolak jalan jika keduanya tidak valid, dan menolak `DEMO=1`.

Admin masuk dengan nomor HP dan PIN itu. Nilai disimpan sebagai hash. PIN bisa diganti dari pengaturan. PIN karyawan juga di-hash. Nomor yang sama juga menjadi karyawan, jadi admin bisa absen seperti yang lain. Setelah PIN di layar depan, tautan Admin membuka dasbor tanpa login lagi. Login di `/admin` tetap memakai nomor dan PIN yang sama.

Data percobaan (tiga lokasi contoh dan tiga karyawan) hanya muncul jika `DEMO=1` dan `DEMO_PIN` diisi, dan tidak pernah di production. Wajah belum terdaftar sampai admin mengambil satu foto depan.

Foto bukti absen disimpan di `UPLOAD_DIR` (bawaan `data/uploads/`) dan tidak masuk git. Hanya admin yang bisa membukanya. Foto lebih lama dari pengaturan simpan (bawaan 90 hari) dihapus. Setiap masuk dan pulang memunculkan lonceng di dasbor. `WA_NOTIFY_URL` dan kunci VAPID kosong berarti WhatsApp dan notifikasi ponsel tidak dikirim.

## Cara pakai

1. Admin membuat lokasi (nama, kelompok usaha, lintang/bujur, radius). Peta bisa diketuk.
2. Admin membuat karyawan: nomor HP, PIN 4–6 angka, usaha, lokasi yang diizinkan, dan jam masuk opsional.
3. Admin mendaftarkan wajah di perangkat yang sama dengan karyawan.
4. Karyawan masuk, berdiri di dalam radius lokasi, lalu absen. Begitu wajah terdeteksi, server mencocokkan descriptor-nya dan tombol Clock In atau Clock Out langsung muncul. Tidak ada kedipan, gelengan, atau syarat wajah lurus.

## Deploy di VPS Biznet Gio

1. Buat VPS Ubuntu dan arahkan DNS `A` domain ke IP VPS.
2. Pasang Docker serta plugin Compose.
3. Salin repo ke server, lalu:

```bash
cp .env.example .env
```

4. Di `.env`, isi `ADMIN_PHONE` dan `ADMIN_PIN`, `DOMAIN=absen.domain-anda.com`, lalu set `COOKIE_SECURE=1`, `TRUST_PROXY=1`, dan `NODE_ENV=production`. Jangan set `DEMO=1`.
5. Jalankan:

```bash
docker compose --profile https up -d --build
```

Caddy meminta sertifikat HTTPS sendiri. Aplikasi hanya terbuka di `127.0.0.1:3000` pada VPS; yang publik adalah port 443.

Data absensi dan foto ada di volume Docker `hadir-data`. Cadangkan volume itu. Untuk mencoba tanpa domain, `docker compose up -d --build` lalu buka SSH tunnel ke port 3000. Ponsel di internet tetap butuh HTTPS.

Ubah kata sandi admin dari dasbor setelah masuk.

## Variabel

Lihat `.env.example`. Yang paling sering diubah: `FACE_MATCH_MAX_DISTANCE` (lebih kecil lebih ketat) dan `MAX_GPS_ACCURACY_METERS` (naikkan jika sinyal di dalam toko lemah, misalnya 150).

## Batasan

- Pencocokan wajah memakai model kecil di browser dan di server. Pencahayaan buruk, wajah terlalu jauh, kacamata, atau penutup kepala yang berbeda dari foto daftar bisa ditolak walaupun orangnya benar. Bukan sistem biometrik bersertifikat.
- Pencocokan memakai satu foto dan descriptor wajah. Tidak ada pemeriksaan kedipan, gerakan, atau ketajaman. Video yang diputar, topeng, atau permintaan API yang dipalsukan masih bisa lolos. GPS dan pagar lokasi tetap diperiksa.
- GPS ponsel bisa dipalsukan aplikasi lokasi palsu. Server hanya menolak akurasi yang terlalu buruk dan menyimpan titik sebagai bukti.
- Server memeriksa ulang foto yang dikirim (bukan angka dari browser), tetapi pemeriksaan satu foto tetap bisa terkecoh kondisi di atas.

## Pengembangan

```bash
npm test
```

Tes mencakup jarak geofence, batas akurasi, pilihan lokasi terdekat, aturan absen (belum terdaftar, sudah masuk, belum masuk, terlambat WIB, ambang wajah), foto depan, dan alur HTTP dengan database sementara.
