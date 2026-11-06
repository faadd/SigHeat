# Perubahan SigHeat

## 5.0.0 — pembelajaran pusat dan bukti evaluasi

Basis perubahan adalah ZIP SigHeat versi 4.1.0 yang dilampirkan. Implementasi mempertahankan engine Ridge/K-Means, protokol MQTT, edge Browser/Termux, peta, dan heatmap yang sudah ada.

- Menambahkan layanan Node.js dan SQLite untuk penerimaan telemetri, pembelajaran otomatis, model bersama, dan arsip evaluasi.
- Menambahkan prediksi tercatat sebelum target, pembanding bootstrap beku, serta MAE blok 24 target yang tidak saling tumpang-tindih.
- Menyimpan percobaan kandidat, penolakan, pergantian metode, dan evaluasi K-Means agar proses belajar dapat diperiksa.
- Menambahkan pengambilan model berversi dan cache valid terakhir pada mode pusat; training nyata browser dinonaktifkan pada mode tersebut.
- Menempatkan grafik dan ekspor bukti di panel **Rincian pembelajaran & cadangan**, tanpa tab baru.
- Menambahkan antrean publikasi model parameter, manifest/checksum, dan workflow GitHub Pages yang eksplisit.
- Menambahkan dukungan pemulihan koneksi edge beserta panduan operasi tanpa tab dashboard yang terbuka.
- Menyediakan panduan pemula, migrasi, backup/pemulihan, publikasi, serta batas pengukuran ketika perangkat mati atau browser ditutup.

Hasil tes aktual dan keterbatasan verifikasi dicatat dalam [laporan validasi paket v5](docs/VALIDASI_V5.md). Tidak ada klaim bahwa paket ini telah dipasang ke akun GitHub, broker privat, atau HP fisik pengguna.

Riwayat versi sebelumnya tersedia di [docs/CHANGELOG.md](docs/CHANGELOG.md).
