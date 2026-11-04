# File yang di-commit ke GitHub

Commit **isi proyek versi 4 ke root repository SigHeat**, dengan struktur folder yang sama. Tidak perlu mengunggah ZIP ke dalam repository. File HTML, JavaScript, model, dan dokumentasi harus merupakan satu versi yang cocok; mengganti HTML saja akan meninggalkan dependensi lama.

## File aplikasi dan model

| File/folder | Alasan disertakan |
|---|---|
| `dashboard.html` | Halaman peta dengan ringkasan pembelajaran; tab training lama dihapus |
| `assets/app.js`, `assets/core.js`, `assets/style.css` | Integrasi peta, kategori ML, agregasi, dan tampilan |
| `assets/ml.js` | Ridge, fitur lag, evaluasi, dan konteks lintas boot |
| `assets/ml-ui.js` | Inferensi otomatis, status, ekspor, pemulihan, dan penghapusan pembelajaran |
| `assets/learning.js` | Kandidat otomatis, pembandingan data baru, konteks, dan persistensi |
| `assets/clusters.js` | K-Means dan centroid awal yang langsung dapat dipakai |
| `assets/default-model.js` | Parameter Ridge bawaan untuk browser |
| `assets/learning-seed.js` | Tempat model awal hasil pengukuran kelompok; awal paket kosong |
| `models/default-rtt.json`, `models/default-clusters.json` | Artefak numerik yang dapat diperiksa dan direproduksi |
| `scripts/build-default-model.cjs`, `scripts/build-cluster-default.cjs` | Membuat ulang model awal sintetis |
| `scripts/build-learning-seed.cjs` | Mengemas cadangan pengukuran tervalidasi sebagai model awal kelompok |
| `package.json` | Versi dan perintah pemeriksaan/build |

Pertahankan file aplikasi asli yang tetap diperlukan: `index.html`, `assets/edge.js`, `assets/vendor/`, `server.py`, file Python edge dan sensor, `requirements.txt`, serta konfigurasi contoh. File yang tidak berubah tidak perlu dibuat ulang sebagai perubahan commit.

## Pengujian, data contoh, dan dokumentasi

Sertakan folder `tests/` lengkap agar pemeriksaan sesuai kode yang diterbitkan. Tes versi 4 mencakup clustering, konteks regresi, pengelolaan pembelajaran, pemulihan, seed, dan integrasi UI.

Sertakan `README.md`, `docs/`, `THIRD_PARTY.md`, dan `PACKAGE_MANIFEST.json` dari paket. `docs/Pembahasan_SigHeat_AI_v4.pdf` adalah pembahasan versi 4. Dataset sintetis serta model demo lama dapat tetap berada di `data/` dan `models/demo/`; keduanya diberi asal sintetis dan bukan data pengukuran kelompok.

## Sesudah kelompok mengumpulkan data nyata

Gunakan `scripts/build-learning-seed.cjs` seperti dijelaskan pada `docs/UPGRADE_V4.md`. Commit perubahan `assets/learning-seed.js` yang dihasilkan bila kelompok memang ingin hasil belajar itu menjadi bawaan situs. File backup mentah tidak perlu ikut di-commit. Seed memuat metadata konteks seperti alamat broker dan ID perangkat; periksa sebelum menerbitkannya.

Menerbitkan seed tidak memperbarui cadangan lokal pengguna yang sudah ada. Cadangan lokal valid lebih diprioritaskan; pengujian seed baru sebaiknya dilakukan pada profil browser baru dengan konteks pengukuran yang cocok.

## Yang tidak di-commit

- `.env`, password/token broker, token ngrok, private key, dan konfigurasi lokal berkredensial.
- Cadangan pribadi browser, hasil ekspor GPS, atau dataset nyata yang belum diperiksa untuk publikasi.
- Cache Python, `node_modules`, berkas sementara, dan log lokal.
- ZIP hasil ekstraksi sebagai pengganti source proyek.

`.env.example` boleh disertakan selama hanya memuat contoh tanpa rahasia. Data pembelajaran dalam browser tidak otomatis dikirim ke GitHub.

## Pemeriksaan sebelum commit

Dari root repository lokal:

```bash
git status --short
git diff --stat
npm test
python -m unittest discover -s tests -p 'test_*.py'
```

Tinjau isi perubahan, tambahkan file yang telah diperiksa, lalu buat commit. Contoh pesan commit: `Add automatic persistent learning and K-Means connection profiles`. Paket ini tidak melakukan commit, push, atau deployment atas nama kelompok.
