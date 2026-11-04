# Bahan presentasi SigHeat dengan ML

Gunakan susunan ini untuk menjelaskan proyek dalam sekitar 8–12 menit. Isi hasil pengukuran nyata setelah kelompok menguji dua HP; jangan menggantinya dengan metrik demo sintetis.

| Slide | Isi yang dijelaskan | Bukti yang ditampilkan |
|---|---|---|
| 1. Masalah | Kondisi respons koneksi dapat berubah; pemantauan saat ini belum memberi perkiraan pengukuran berikutnya. | Dashboard dan tujuan proyek |
| 2. SigHeat asli | Dua HP, accelerometer, gyroscope, RMS, integrasi rotasi, probe MQTT, dashboard, command dan ACK. | Diagram arsitektur dan perangkat kelompok |
| 3. Perbandingan ide | Klasifikasi perlu label independen; anomaly detection perlu baseline normal; forecasting punya target otomatis. | Tabel keputusan dari `AI_ML.md` |
| 4. AI yang dipilih | Input A: riwayat dan konteks sensor; output B: RTT probe berikutnya. Model: Ridge. | Contoh jendela enam sampel dan satu target |
| 5. Dataset | Konteks perangkat/sesi dipisah; gagal probe tetap null; data sintetis dan nyata dibedakan. | Potongan CSV tanpa lokasi pribadi |
| 6. Training | Bobot dipelajari dari data; normalisasi dari train; alpha dipilih dari validation. | Koefisien atau ringkasan model |
| 7. Evaluasi | Pembagian waktu 60/20/20; MAE/RMSE; pembanding persistence dan rerata bergerak. | Tabel evaluasi dan jumlah pasangan |
| 8. Demo | Jalankan panel ML, perlihatkan pelatihan, metode terpilih, prediksi, dan peringatan. | Rekaman layar dengan label asal data terlihat |
| 9. Hasil kelompok | Bandingkan model dan baseline pada data test serta sesi baru. | Angka hasil nyata, termasuk kegagalan dan batasan |
| 10. Kesimpulan | ML menambahkan prediksi; manfaatnya harus diukur; timeout dan dBm bukan target model ini. | Temuan spesifik dari eksperimen |

## Contoh penjelasan lisan

“SigHeat mengukur RTT pesan aplikasi melalui MQTT. Kami memilih prediksi pengukuran berikutnya karena labelnya tersedia otomatis dari telemetri sesudahnya. Enam pengukuran terakhir menjadi bagian input, dan RTT berikutnya menjadi target. Regresi Ridge mempelajari bobot input dari bagian training. Kami memilih regularisasi dengan validation dan mengukur kesalahan pada test yang berada sesudahnya. Hasil dibandingkan dengan menebak nilai terakhir dan rata-rata bergerak. Jika model belum lebih baik, dashboard menyatakan baseline yang dipilih. Dengan demikian kami bisa membedakan keberhasilan membuat pipeline ML dari bukti bahwa model bermanfaat pada jaringan nyata.”

## Pertanyaan yang mungkin muncul

**Mengapa disebut machine learning?** Karena bobot regresi diperoleh dari pasangan data input-target. Rumus menghitung inferensi tetap, tetapi parameternya merupakan hasil pelatihan.

**Mengapa tidak cukup moving average?** Moving average memang pembanding yang masuk akal. ML baru layak dipilih jika hasil validation menunjukkan peningkatan sesuai kebijakan proyek; tabel test memeriksa apakah peningkatan itu bertahan.

**Mengapa tidak memakai neural network?** Proyek belum memiliki dataset besar dan tujuannya satu angka. Ridge cukup ringan untuk berjalan di browser serta lebih mudah dijelaskan dan diperiksa. Kompleksitas tambahan perlu alasan dari hasil eksperimen.

**Apakah dua sensor benar-benar digunakan?** Fungsi IoT asli tetap menghitung RMS accelerometer dan gyro/integrasi rotasi. Fitur ML menyertakan konteks sensor beserta penanda data hilang. Peran sensor dalam akurasi perlu diuji, bukan diasumsikan dari keberadaannya.

**Apakah model memprediksi sinyal Wi-Fi?** Targetnya RTT MQTT, bukan dBm. Banyak komponen jalur aplikasi dapat memengaruhi RTT.

**Mengapa tidak ada akurasi persen?** Ini regresi. Kesalahan dinilai dalam ms menggunakan MAE/RMSE. Persentase “accuracy” tanpa definisi tugas yang tepat dapat menyesatkan.

**Bagaimana ketika internet putus?** Tidak ada target RTT numerik dari probe yang gagal. Sistem menunjukkan kegagalan atau belum bisa memprediksi; model ini tidak memperkirakan probabilitas putus koneksi.

**Apakah hasil demo membuktikan model bekerja di kampus?** Tidak. Demo menggunakan data buatan untuk menunjukkan alur fungsi. Klaim kampus memerlukan data pengukuran kampus.

## Pembagian pekerjaan kelompok

| Peran | Tanggung jawab | Hasil yang diserahkan |
|---|---|---|
| Anggota 1 | Dua HP, sensor, broker dan kondisi eksperimen | Catatan perangkat, konfigurasi, log koneksi dan video |
| Anggota 2 | Dataset, pemeriksaan kualitas data, training dan evaluasi | CSV, model JSON, tabel MAE/RMSE dan catatan data yang dikeluarkan |
| Anggota 3 | Dashboard, demo, dokumentasi dan narasi presentasi | Video demo, slide, hasil uji manual dan penjelasan batasan |

Sesuaikan pembagian dengan pekerjaan nyata masing-masing. Semua anggota sebaiknya dapat menjelaskan A → B, alasan pemilihan model, pemisahan test, dan perbedaan demo dengan hasil lapangan.

Cantumkan penggunaan bantuan AI dalam dokumentasi sesuai kebijakan dosen, misalnya bahwa asisten membantu peninjauan rancangan, implementasi, dan penyusunan panduan, sedangkan kelompok memeriksa kode, mengumpulkan data, menguji perangkat, dan mempertanggungjawabkan hasilnya. Jangan mengklaim pengujian yang belum dilakukan.
