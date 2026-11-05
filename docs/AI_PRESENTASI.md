# Bahan presentasi SigHeat 4.0

Dokumen ini adalah kerangka isi, bukan klaim hasil eksperimen yang belum dilakukan. Isi tabel hasil nyata setelah kelompok menguji perangkat.

## Susunan pembahasan

| Slide | Isi utama | Bukti yang ditampilkan |
|---|---|---|
| 1. Masalah | Pengamatan RTT menunjukkan kondisi sekarang; batas kualitas tetap kurang menyesuaikan pola pengukuran | Contoh kebutuhan pengguna, bukan angka akurasi buatan |
| 2. Sistem IoT | Dua HP, accelerometer dan gyroscope, RMS dan integrasi rotasi, MQTT, dashboard | Diagram alur dan perangkat fisik |
| 3. Perubahan versi 4 | Tidak ada tombol training untuk pengguna; model awal dan pembelajaran otomatis | Halaman peta dan ringkasan model |
| 4. Supervised learning | Enam RTT dan konteks sebagai A; RTT aktual berikutnya sebagai B | Contoh pasangan riwayat-target |
| 5. Ridge | Bobot dipelajari dari data, regularisasi, pembanding RTT terakhir/rerata | Potongan rumus dan metrik yang tersedia |
| 6. Unsupervised learning | K-Means menemukan tiga kelompok profil tanpa label threshold | Fitur, centroid, label beban relatif |
| 7. Pembaruan otomatis | Kandidat dibuat dari riwayat, diuji pada data baru, diterima atau ditolak | Status kandidat dan catatan promosi |
| 8. Penyimpanan | Model bisa dipakai kembali pada browser/origin sama, window tidak lintas boot | Refresh, penerimaan telemetri baru, backup |
| 9. Hasil pengujian | Pisahkan tes otomatis, data sintetis, dan dua HP nyata | Tabel hasil yang benar-benar dijalankan |
| 10. Batas dan pengembangan | RTT bukan dBm, model awal sintetis, kategori relatif, data nyata belum tentu membuat hasil lebih baik | Contoh keterbatasan dan rencana eksperimen |

## Narasi singkat

“SigHeat tetap memakai dua HP untuk membaca sensor dan mengukur perjalanan pesan melalui broker MQTT. Pada versi lama, kategori kualitas ditentukan oleh batas RTT tetap. Sekarang kategori pengamatan ditentukan oleh K-Means yang mempelajari centroid dari profil RTT, jitter, dan keberhasilan probe.

Ridge memprediksi RTT berikutnya menggunakan riwayat pengukuran dan konteks sensor. Pengguna tidak diminta training: model awal sudah tersedia, dan kandidat pembaruan dibentuk di belakang layar. Kandidat harus dibandingkan dengan model aktif serta baseline pada pengukuran baru sebelum dipakai.

Model awal dalam paket dibuat dari data sintetis. Karena itu kami membedakan demonstrasi fungsi dari bukti performa jaringan nyata. Pengukuran nyata kelompok, evaluasi, dan keterbatasannya ditampilkan terpisah.”

## Pertanyaan yang mungkin muncul

**Apa yang menggantikan threshold?**

Kategori/warna dashboard berasal dari jarak ke centroid K-Means yang dipelajari. Batas pemeriksaan data atau jumlah minimum contoh tetap ada karena itu aturan validasi, bukan batas kualitas koneksi.

**Apakah “belajar sendiri” berarti unsupervised semuanya?**

Tidak. Ridge tetap supervised karena targetnya RTT aktual berikutnya. K-Means unsupervised karena tidak memiliki label kategori training. Otomatisasi menjelaskan kapan proses berjalan, bukan jenis pembelajarannya.

**Apakah model bawaan sudah dilatih dari jaringan kelompok?**

Belum, kecuali kelompok telah melakukan percobaan nyata, mengevaluasi model, dan menyimpan hasilnya sendiri. Bawaan paket bersifat sintetis dan berlabel jelas. Kelompok dapat mengemas cadangan hasil belajar nyata menjadi `assets/learning-seed.js` sebelum demo, sehingga browser baru memuatnya otomatis. Jangan menyebut bootstrap sintetis sebagai model lapangan.

**Apakah model pasti membaik jika demo berkali-kali?**

Tidak. Data harus sesuai konteks dan bermanfaat. Kandidat yang belum mengungguli pembanding dipertahankan sebagai hasil evaluasi, bukan dipromosikan paksa.

**Mengapa masih ada baseline?**

Agar manfaat model dapat dinilai. Prediksi sederhana kadang lebih baik, terutama saat pola data tidak cukup mendukung regresi.

**Apakah cluster tinggi berarti Wi-Fi rusak atau dead zone?**

Tidak. Itu profil beban relatif dalam ruang fitur model. RTT aplikasi dipengaruhi broker, runtime, dan jaringan; model tidak membuktikan penyebab.

**Apa arti MAE dan jarak kuantisasi?**

MAE adalah rata-rata besar kesalahan prediksi RTT dalam ms. Jarak kuantisasi adalah jarak profil ke centroid dalam transformasi fitur tetap. Keduanya bukan persentase akurasi dan tidak dapat dipertukarkan.

**Apa yang terjadi jika browser di-refresh?**

Model dan data yang berhasil disimpan dimuat kembali. Telemetri baru tetap diperlukan untuk status live; penilaian kandidat yang belum selesai dimulai ulang.

## Pembagian kerja yang dapat dipakai kelompok

| Peran | Pekerjaan konkret |
|---|---|
| IoT/perangkat | Menyiapkan dua HP, sensor, broker, command/ACK, dan mencatat konfigurasi |
| Model/data | Memeriksa fitur-target, pemisahan waktu, hasil baseline, status kandidat, dan dataset |
| Dashboard/dokumentasi | Memeriksa tampilan, label asal data, backup, video demo, dan tabel laporan |

Pembagian bukan pembatas pemahaman: setiap anggota sebaiknya dapat menjelaskan kedua model dan membedakan data sintetis dari pengukuran nyata. Cantumkan bantuan alat pengembangan sesuai aturan mata kuliah, lalu jelaskan pekerjaan dan pengujian yang benar-benar dilakukan kelompok.
