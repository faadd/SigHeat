# Pemeriksaan paket SigHeat 4.1

Tanggal: 4 November 2026.

## Dasar dan perubahan

Paket dibuat dari `SigHeat-main (1)(1).zip` yang dilampirkan pengguna dan pengembangan versi 3 pada percakapan ini. Konektor GitHub tidak berhasil dipakai; kesamaan dengan commit terbaru repository belum diverifikasi. Tidak ada commit, push, atau deployment ke GitHub.

Versi 4 menghapus tab training, memuat parameter model awal secara otomatis, menampilkan prediksi di halaman peta, mengganti kategori threshold dashboard dengan K-Means, serta menyimpan model dan riwayat untuk pembelajaran berkala. Kandidat dinilai pada pengukuran baru sebelum dipakai. Cadangan JSON dan pengemasan model kelompok tersedia. Fungsi dua HP, MQTT, command/ACK, dan pengolahan sensor asli dipertahankan.

## Tambahan versi 4.1: Mode Heatmap

Mode Heatmap berada tepat setelah Peta jalan dan memakai Canvas lokal di atas Leaflet. Warna dibentuk dari kategori ML aktif, dihaluskan dalam radius 35 m, dengan legenda yang sesuai. Tidak ada API key atau dependensi layanan heatmap berbayar. Titik dengan kategori tidak diketahui, timeout, atau akurasi lokasi lebih buruk dari 35 m tidak membentuk permukaan warna. Sumber/konteks berbeda tidak dicampur.

Dua puluh satu tes baru memeriksa engine dan integrasi heatmap, termasuk normalisasi, area transparan, data berulang, warna aktual piksel, pembaruan model, pergantian mode, lifecycle Canvas, peta dasar gagal, dan batas memori/kerja raster. Raster sintetis benar-benar dirender dan diperiksa; luminansi lima warna berurutan meningkat, dan simulasi deuteranopia diperiksa sebagai pemeriksaan tambahan. Ini bukan sertifikasi aksesibilitas atau screenshot browser.

Batas radius dan bin berlaku sebagai pendekatan lokal di peta Web Mercator. Permukaan bukan cakupan radio dan tidak mengisi seluruh wilayah yang belum diukur. Panduan baru ada di `HEATMAP.md`. PDF `Pembahasan_SigHeat_AI_v4.pdf` tetap menjelaskan dasar AI versi 4.0; hasil tes versi 4.1 yang terbaru ada pada dokumen ini.

## Bukti pengujian

| Pemeriksaan | Hasil |
|---|---|
| `node --test tests/*.cjs` | 120 tes lulus, 0 gagal |
| `python -m unittest discover -s tests -p 'test_*.py'` | 26 dijalankan: 25 lulus, 1 dilewati |
| Tes Python yang dilewati | Pemeriksaan konteks TLS klien Paho nyata; dependensi Paho MQTT belum tersedia |
| Sintaks dan aset | Seluruh JS aplikasi/script lulus `node --check`; referensi aset HTML tersedia |
| Model awal | Artefak numerik valid dan deterministik; membuka dashboard tidak memanggil training awal |
| Ridge dan penyimpanan | Target berurutan, pemisahan waktu/boot/konteks, 24 target baru untuk evaluasi, baseline, refresh, kuota, dan seed diperiksa |
| K-Means dan dashboard | Kategori benar-benar memakai centroid; label lama payload diabaikan; titik lama, tabel, grafik dan grid memakai classifier aktif |
| Pemulihan cadangan | Perubahan parameter tanpa ID sesuai, model lintas konteks, serta model Ridge yang memakai masa depan cache ditolak |
| Isolasi simulasi | Data sintetis tidak mengubah atau mengusir pembelajaran pengukuran nyata |
| CLI | Latihan `--context` mendukung beberapa boot; penjagaan data sintetis dan mode lama diperiksa |
| Raster dan ZIP | Raster heatmap serta palet diperiksa melalui render; CRC ZIP dan hash isi diperiksa saat pengemasan |

Tes UI memakai DOM tiruan, dengan engine pembelajaran sebenarnya untuk skenario integrasi tertentu. Ini memeriksa perilaku aplikasi, bukan tampilan browser fisik. Satu tes Python yang dilewati bukan bukti TLS gagal; pasang `requirements.txt` untuk menjalankannya pada lingkungan yang sesuai.

## Pemeriksaan numerik independen

Ridge diuji terpisah terhadap NumPy menggunakan fixture sintetis 960 baris dengan dua boot. Selisih maksimum koefisien sekitar 8,30e-10 dan selisih maksimum prediksi 9,12e-12 ms. MAE bagian uji fixture sekitar 2,045 ms cocok antara kedua implementasi. Angka ini memeriksa perhitungan, bukan ketepatan di jaringan kelompok.

Centroid K-Means dihitung ulang dari penugasan anggota: ketiga kelompok masing-masing memiliki 160 baris, rerata centroid cocok, dan inertia sekitar 0,2814171546 cocok dengan artefak. Inertia adalah galat kuantisasi dalam ruang fitur, bukan persentase akurasi kategori.

## Batas bukti

- Belum diuji end-to-end dengan dua HP fisik, broker kelompok, izin sensor, atau perubahan kondisi jaringan nyata.
- Tampilan dashboard belum diperiksa secara visual pada browser desktop/mobile; verifikasi UI saat ini melalui DOM tiruan.
- Arsip sumber tidak menyediakan histori pengukuran nyata kelompok. Model awal dan dataset contoh yang dikemas bersifat sintetis dan diberi label demikian.
- Adaptasi berkala memakai riwayat terbatas; penggunaan berulang tidak menjamin model makin baik. Model dapat tetap memakai bawaan atau baseline sampai kandidat memenuhi syarat.
- Model dan data lokal tidak tersinkron otomatis antarbrowser. Konteks model harus cocok setelah pemulihan atau pengemasan seed.
- ID/hash model memeriksa konsistensi, bukan tanda tangan digital atau autentikasi sumber perangkat.

Ikuti `AI_DEMO_DAN_PENGUJIAN.md` untuk uji lapangan dan `FILES_TO_COMMIT.md` untuk menyalin perubahan ke GitHub. Paket mempertahankan seluruh file sumber asli yang diperlukan serta vendor frontend, tanpa cache Python, kredensial aktif, atau node_modules.

`PACKAGE_MANIFEST.json` mencatat SHA-256 seluruh isi paket selain manifest itu sendiri, hash ZIP sumber, serta file yang ditambah/diubah. Manifest memeriksa integritas berkas dan bukan tanda tangan digital.
