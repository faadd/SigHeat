# File yang di-commit ke GitHub — SigHeat v5

Commit **isi source proyek v5 ke root repository SigHeat**, dengan struktur folder yang sama. Tidak perlu memasukkan ZIP ke repository. HTML, JavaScript, backend, model, dan dependensi harus berasal dari versi yang cocok; mengganti `dashboard.html` saja tidak cukup.

Ada dua pekerjaan yang berbeda: **commit source** menyimpan program di GitHub, sedangkan **deployment Pages** menyajikan hasil build website. Backend pusat tetap dijalankan pada mesin Node.js; GitHub Pages tidak menjalankan training atau database.

## 1. Source dan konfigurasi contoh

| File/folder | Alasan disertakan |
|---|---|
| `index.html`, `dashboard.html` | Pengukur browser dan dashboard; grafik berada di panel rincian pembelajaran |
| `assets/app.js`, `assets/core.js`, `assets/edge.js`, `assets/style.css` | MQTT, validasi, sensor, peta, kontrol, dan tampilan |
| `assets/ml.js`, `assets/clusters.js`, `assets/default-model.js` | Engine Ridge/K-Means serta bootstrap sintetis |
| `assets/central-client.js`, `assets/central-ui.js`, `assets/central-ui.css`, `assets/central-config.js` | Pemeriksaan model terbitan/pusat, cache, pengaturan API, grafik, dan ekspor bukti |
| `assets/ml-ui.js`, `assets/learning.js`, `assets/learning-seed.js` | Integrasi ringkasan ML dan kompatibilitas mode lokal lama; seed paket awal tetap kosong |
| `assets/heatmap.js`, `assets/heatmap-layer.js`, `assets/vendor/` | Heatmap, Leaflet/Paho browser, dan lisensi aset yang disertakan |
| `server/` | Konfigurasi pusat, listener MQTT, SQLite, training/evaluasi, API, artefak, dan antrean publikasi |
| `scripts/` | Build publik, administrasi backup/restore/rollback, skrip Termux, dan CLI eksperimen |
| `models/default-rtt.json`, `models/default-clusters.json` | Model bawaan sintetis yang dapat diperiksa |
| `models/latest.json`, `models/releases/` | Manifest dan artefak parameter berversi yang memang disiapkan untuk publikasi |
| `package.json`, `package-lock.json` | Versi program, perintah npm, serta versi/integritas dependensi |
| `.env.central.example`, `.env.example` | Contoh konfigurasi pusat dan edge, tanpa rahasia |
| `.github/workflows/pages.yml` | Build dan deployment Pages yang eksplisit |
| `Dockerfile`, `compose.yaml`, `.dockerignore`, `deploy/` | Contoh pemasangan layanan pusat dan reverse proxy |
| File Python edge/sensor, `requirements.txt`, `server.py`, `conf/` | Pengukur Termux, kontrak sensor, serta utilitas/config lama yang masih diperlukan |
| `.gitignore`, `.nojekyll` | Pengecualian file privat/lokal dan dukungan website statis |

`assets/central-config.js` boleh memuat alamat layanan/manifest publik bila sengaja dikonfigurasi untuk kelompok. Jangan meletakkan token baca, password broker, atau token GitHub pada file JavaScript publik.

Paket parameter dapat memuat ID proyek/perangkat dan alamat broker tanpa kredensial untuk pencocokan konteks. Tinjau metadata tersebut sebelum menerbitkan repository publik. Paket tidak boleh memuat dataset mentah, GPS, atau cadangan lengkap.

## 2. Pengujian dan dokumentasi

Sertakan `tests/`, `README.md`, `CHANGELOG.md`, `docs/`, `THIRD_PARTY.md`, serta `PACKAGE_MANIFEST.json` dari paket. Jangan memasukkan hasil sementara tes atau log lokal sebagai source.

Panduan utama saat ini adalah [Mulai di sini v5](MULAI_DI_SINI_V5.md), [Arsitektur v5](ARSITEKTUR_V5.md), [Migrasi](MIGRASI_V4_V5.md), dan [Publikasi](PUBLISHING.md). Laporan pengujian paket ada di [Validasi v5](VALIDASI_V5.md).

Dokumen dan PDF versi lama dipertahankan sebagai referensi historis. Khususnya `docs/Pembahasan_SigHeat_AI.pdf` serta `docs/Pembahasan_SigHeat_AI_v4.pdf` **bukan panduan fitur pusat v5**. Pernyataan dalam dokumen lama tentang pembelajaran dan penyimpanan per browser berlaku untuk mode lokal lama.

Fixture sintetis yang sudah diberi label, seperti `data/demo-synthetic.csv` dan artefak `models/demo/`, boleh tetap disimpan sebagai contoh/pengujian. Jangan menggantinya dengan pengukuran pribadi lalu meng-commit tanpa pemeriksaan.

## 3. Setelah kelompok mengumpulkan data nyata

Pada alur v5, layanan pusat menyimpan pengukuran dan melatih otomatis. Jika publikasi GitHub diaktifkan, perubahan parameter yang disiapkan pusat masuk antrean dan diterbitkan sebagai artefak berversi beserta `models/latest.json`. Pengguna tidak perlu mengunggah CSV atau cadangan browser setiap sesi.

Dashboard Pages yang baru dibuka memakai mode pusat dan memeriksa manifest terbitan secara berkala. API pusat tetap perlu dikonfigurasi untuk mengakses riwayat grafik. `assets/learning-seed.js` **bukan mekanisme sinkronisasi model pusat**.

`scripts/build-learning-seed.cjs` tetap tersedia hanya untuk eksperimen/migrasi **mode lokal lama**. Jangan menjadikannya langkah rutin v5. Build Pages v5 mengganti seed browser dengan seed kosong agar cadangan lokal tidak ikut diterbitkan. Cadangan lokal yang sudah ada juga tidak mengalahkan model pusat ketika mode pusat dipilih.

## 4. File yang tidak di-commit

- `.env`, `.env.central`, atau konfigurasi lokal lain yang berisi password/token.
- `private-data/`, database SQLite, berkas `-wal`/`-shm`, lock penulis, arsip publikasi privat, dan backup database.
- Dataset pengukuran mentah, ekspor CSV/JSON pribadi, koordinat GPS, atau cadangan pembelajaran browser.
- `node_modules/`, virtual environment Python, cache, hasil tes sementara, dan log.
- `public-dist/` atau `dist/`: folder ini dibangun ulang oleh workflow, bukan source yang perlu di-commit.
- ZIP paket atau salinan proyek hasil ekstraksi yang bersarang di dalam repository.

`.env.central.example` dan `.env.example` boleh di-commit karena berisi contoh tanpa rahasia. `.gitignore` membantu, tetapi tetap periksa daftar perubahan; file rahasia yang sudah pernah dilacak Git tidak otomatis hilang dari riwayat hanya karena ditambahkan ke `.gitignore`.

## 5. Pemeriksaan sebelum commit dan deployment

Dari root proyek:

```bash
git status --short
git diff --stat
npm ci
npm test
npm run test:python
npm run build:public
```

Tes Python memerlukan dependensi dari `requirements.txt` pada lingkungan Python yang dipakai. Hasil pengujian adalah pemeriksaan perangkat lunak; itu tidak sama dengan pengujian HP/broker nyata.

Tinjau isi perubahan, tambahkan hanya source yang telah diperiksa, lalu buat commit. Contoh pesan commit: `Add centralized learning and auditable evaluation charts`.

Untuk Pages, gunakan **Settings → Pages → Source: GitHub Actions** dan workflow yang disertakan. Workflow menyajikan **`public-dist/` hasil build allowlist**, bukan seluruh root repository. Database, `server/`, `.env`, dataset, dan dokumen privat tidak menjadi aset website. Ikuti [panduan publikasi](PUBLISHING.md) untuk pengaturan token dan pemicu deployment model.

ZIP yang diterima tidak otomatis melakukan commit, push, deployment, atau memasang layanan pusat pada akun/mesin kelompok.
