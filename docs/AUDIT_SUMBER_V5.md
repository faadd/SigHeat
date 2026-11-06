# Audit sumber dan keputusan implementasi v5

Arsip yang diperiksa adalah `SigHeat-main (2).zip` (101 entri, 510.216 byte). `package.json` menunjukkan versi 4.1.0. Dua Markdown instruksi yang diberikan berisi teks identik, sebanyak 428 baris, dan dibaca sampai selesai.

Versi sumber sudah memiliki MQTT browser/Termux, sensor, peta/heatmap, engine Ridge dan K-Means, pemisahan konteks, kandidat otomatis, serta cadangan pembelajaran browser. Kelemahannya untuk kebutuhan baru: penyimpanan dan training mengikuti browser masing-masing; riwayat audit terpusat dan kurva prediksi yang tercatat sebelum target belum tersedia sebagai layanan bersama.

Keputusan implementasi:

1. Pertahankan engine numerik `assets/ml.js` dan `assets/clusters.js`, kontrak MQTT, serta peta. Tambahkan satu penulis pusat Node.js 24 dengan SQLite bawaan Node, bukan menulis ulang algoritma dalam bahasa lain.
2. Simpan pengukuran, kandidat, prediksi, keputusan dan versi dalam database privat; pisahkan batas buffer training dari arsip lengkap.
3. Gunakan parameter pusat untuk inferensi browser yang kompatibel. Grafik mengambil catatan pusat, bukan prediksi hasil pemutaran ulang model baru pada masa lalu.
4. Tempatkan grafik langsung di **Rincian pembelajaran & cadangan**, sesuai gambar/chat teman. Grafik naik atau turun mengikuti data; tidak ada tab training baru.
5. Terbitkan hanya paket parameter yang lolos validasi melalui antrean GitHub dan workflow Pages eksplisit. Pusat tetap bekerja ketika publikasi belum dikonfigurasi atau sedang tertunda.
6. Simpan mode lokal lama sebagai pilihan eksplisit; dashboard baru menggunakan mode pusat. Data contoh tetap terpisah.
7. Tambahkan pemulihan koneksi dan wake lock yang didukung. Sediakan layanan Termux untuk Android, tetapi jangan menyatakan HP mati atau browser tertutup tetap mengukur.

File sementara tes dari arsip sumber, cache, dependensi terpasang, build keluaran, database dan konfigurasi privat tidak dimasukkan ke ZIP rilis. PDF versi lama tetap disertakan sebagai referensi historis. Panduan utama yang sesuai implementasi baru adalah [Mulai di sini v5](MULAI_DI_SINI_V5.md) dan [Arsitektur v5](ARSITEKTUR_V5.md).

Rincian hasil uji dan hal yang belum diuji berada pada [Validasi v5](VALIDASI_V5.md). SHA-256 sumber dan seluruh file rilis dicatat di `PACKAGE_MANIFEST.json`.
