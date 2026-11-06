# Memindahkan proyek dari v4 ke v5

Versi 5 menambahkan layanan pusat; file website saja tidak menjalankan layanan tersebut. Menyalin berkas ke GitHub Pages tidak otomatis memindahkan data yang tersimpan pada browser lama.

## 1. Simpan bukti lama terlebih dahulu

Pada browser/profil yang selama ini dipakai mengukur, buka **Rincian pembelajaran & cadangan** dalam mode lokal lama. Unduh:

- Dataset perangkat dalam CSV.
- Cadangan pembelajaran dalam JSON.
- Catatan konteks: proyek, perangkat, sumber, broker, interval, dan waktu pengamatan.

Simpan salinan privat di luar folder website. Jangan mengunggah dataset pengukuran atau cadangan lengkap ke repository publik hanya untuk menyinkronkan model.

## 2. Perbedaan lokasi penyimpanan

| Informasi | v4 lokal | v5 pusat |
|---|---|---|
| Riwayat fitur untuk training | Penyimpanan browser, dibatasi | Buffer training pusat, dibatasi; arsip data terpisah |
| Model yang aktif | Masing-masing browser | Layanan pusat untuk konteks terkait |
| Bukti evaluasi | Terutama hasil terakhir | Log prediksi, evaluasi, dan riwayat pusat |
| Pindah laptop | Perlu cadangan/seed lokal | Hubungkan dashboard ke pusat/paket model yang sama |
| Training ketika semua dashboard ditutup | Berhenti | Berjalan selama pusat, broker, dan edge aktif |

Penyimpanan browser lama tidak dihapus hanya karena mode pusat dinyalakan. Pada mode pusat, hasil belajar lokal bukan sumber resmi yang menggantikan model pusat.

## 3. Data lama tidak dihitung sebagai evaluasi live baru

Alur penggunaan awal versi 5 dimulai dengan data baru yang diterima layanan pusat. Impor cadangan v4 sebagai data live pusat **bukan alur yang didukung**. Cadangan lama tetap dapat dipakai pada mode lokal yang kompatibel atau dianalisis terpisah menggunakan CLI historis.

CSV lama juga tidak berisi seluruh bukti prediksi yang dicatat sebelum target datang. Karena itu, aplikasi tidak mengarang grafik perkembangan live dari CSV dengan menjalankan model terbaru terhadap masa lalu.

Jika ingin memakai data lama dalam laporan, beri label **evaluasi historis** dan pertahankan provenance serta konteksnya. Hasil tersebut tidak boleh ditambahkan ke hitungan 24 target baru suatu kandidat pusat.

## 4. Ganti versi program

1. Simpan salinan proyek lama dan cadangannya.
2. Ekstrak proyek v5 ke folder baru.
3. Ikuti [panduan awal](MULAI_DI_SINI_V5.md), mulai dari instalasi Node.js dan konfigurasi pusat.
4. Gunakan kembali ID proyek/perangkat yang sesuai. Jika mengubah broker, interval, sumber, atau mode accelerometer, model masuk konteks yang berbeda.
5. Hubungkan dashboard ke layanan pusat. Periksa status sumber model; jangan menganggap model lokal lama otomatis telah diimpor. Dashboard Pages baru memeriksa paket model website dalam mode pusat, tetapi URL API tetap diperlukan untuk grafik riwayat bersama.
6. Jalankan pengukuran baru. Periksa jumlah data dan waktu penerimaan pada pusat.

Enam RTT baru yang berurutan diperlukan untuk prediksi setelah boot/jeda. Riwayat enam lag tidak disambung melintasi reboot agar target tetap masuk akal.

## 5. Berkas yang dimasukkan ke GitHub

Commit **kode sumber dan konfigurasi contoh**, termasuk `server/`, `scripts/`, `assets/`, berkas HTML, `models/` yang memang berisi parameter publik, `tests/`, `docs/`, workflow, `package.json`, dan `package-lock.json`.

Jangan commit `.env`, database SQLite beserta `-wal`/`-shm`, `node_modules/`, file backup privat, token, password, atau dataset pengukuran pribadi. Periksa perubahan sebelum commit; `.gitignore` membantu mencegah kesalahan, tetapi bukan pengganti pemeriksaan.

Workflow website hanya membangun daftar aset publik yang diizinkan. Layanan pusat dipasang pada mesin yang menjalankan Node.js, bukan pada GitHub Pages. Rincian publikasi parameter dan deployment ada di [Publikasi](PUBLISHING.md).

## 6. Kembali ke mode lama

Jika pusat belum siap, mode lokal tetap dapat digunakan untuk demonstrasi lokal sesuai panduan v4. Beri tahu peserta bahwa model/riwayat kembali terpisah per browser. Jangan menyebutnya pembelajaran bersama.

Untuk mengembalikan layanan pusat setelah kerusakan, gunakan prosedur backup/restore v5 dalam [panduan awal](MULAI_DI_SINI_V5.md). Cadangan browser v4 dan database pusat v5 mempunyai format serta cakupan berbeda; keduanya tidak saling menggantikan.
