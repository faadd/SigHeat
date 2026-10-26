# SigHeat: rubrik, uji, dan bukti demo dua opsi

Acuan: PDF _Praktek Multicommunication 2 Arah dan Multisensor_, halaman 14–15. Halaman 23 menunjukkan pembacaan sensor melalui browser iPhone Safari atau Android Chrome; Termux bukan kewajiban tugas.

## Tujuh ketentuan tugas

| No. | Ketentuan pada PDF/screenshot | Penerapan SigHeat | Bukti yang perlu dikumpulkan |
|---:|---|---|---|
| 1 | Kelompok 3–4 orang | Tiga placeholder anggota pada README; tambah anggota keempat bila perlu | Nama, NIM, kontribusi yang benar |
| 2 | Minimal dua edge dan dua sensor | Dua HP fisik, accelerometer + gyroscope; pilih browser atau Termux | Video dua HP dan dua jenis sensor valid pada masing-masing HP |
| 3 | Minimal dua jenis processing | RMS percepatan dan integrasi rotasi; statistik probe sebagai tambahan | Kode, rumus, contoh perhitungan dari data |
| 4 | Algoritma AI atau algoritma lain | Pengolahan numerik dan aturan kategori koneksi | Jelaskan sebagai algoritma, tanpa klaim AI terlatih |
| 5 | Minimal satu protokol terhubung cloud | MQTT over WSS pada kedua opsi | Topic, telemetry, probe, dan broker cloud |
| 6 | Dashboard opsional; jika ada, satu jaringan pengguna | Dashboard laptop pada Wi-Fi/hotspot yang sama dengan dua HP | IP lokal dan skema jaringan; edge browser tetap HTTPS |
| 7 | Ide berbeda dari kelompok lain | SigHeat memetakan kualitas koneksi aplikasi | Kelompok memeriksa sheet kelas; keunikan belum dijamin |

Komunikasi dua arah ditunjukkan oleh command ke HP terpilih, ACK dengan ID/sesi yang cocok, dan telemetry berikutnya. Keluaran tugas adalah kode GitHub, PPT yang menyertakan link repository, dan video demo. Struktur dokumentasi mengadaptasi README PocketGuard yang dilampirkan, sementara fungsi tetap mengikuti SigHeat.

**Dua sensor berarti dua jenis sensor fisik yang benar-benar terbaca.** Satu accelerometer yang menghasilkan x/y/z tetap satu jenis sensor. Dua tab pada laptop tetap satu perangkat. Geolocation menjadi konteks tambahan; API lokasi browser tidak membuktikan GPS hardware dipakai.

Jika browser hanya mengukur koneksi karena sensor tidak tersedia, bagian koneksi masih dapat dicoba, tetapi bukti multisensor tugas belum terpenuhi. Data kosong tidak boleh diganti angka simulasi.

## Bobot dari PDF

| Komponen             | Bobot | Bukti utama                                                       |
| -------------------- | ----: | ----------------------------------------------------------------- |
| Ide/orisinalitas     |   20% | Masalah, pengguna, pembatasan kualitas aplikasi versus daya radio |
| Arsitektur           |   15% | Dua HP, dua sensor, jaringan bersama, broker cloud                |
| Processing/algoritma |   20% | RMS, integrasi rotasi, statistik probe, aturan kategori           |
| Komunikasi cloud     |   15% | WSS, topic, telemetry, command, ACK                               |
| Pengujian/demo       |   15% | Data nyata, skenario gagal, dua arah, rekaman                     |
| Dokumentasi          |   15% | README, PPT, sumber, GitHub, video                                |

## Persiapan uji

1. Pilih Opsi A (dua HP browser HTTPS) atau Opsi B (dua Android Termux). Catat model, OS, browser/versi Termux, serta versi kode.
2. Gunakan broker, interval, dan ID proyek yang sama. ID HP berbeda. Catat broker tanpa menampilkan password.
3. Aktifkan waktu otomatis. Perintah memakai batas waktu, sehingga jam sistem yang meleset dapat menyebabkan penolakan.
4. Periksa accelerometer dan gyroscope masing-masing HP. Gerakkan dan putar secara terpisah; periksa jumlah sampel dan nilai olahan.
5. Sambungkan dua HP dan laptop ke satu Wi-Fi/hotspot untuk demo kelas. Halaman edge dapat dihosting HTTPS, sedangkan dashboard dijalankan laptop pada LAN.
6. Pilih titik pengamatan dan izinkan lokasi hanya jika sesuai. Akurasi lokasi yang buruk menjadi batas peta, bukan alasan mengarang titik.
7. Pastikan dashboard menerima sumber `browser` atau `termux` yang sesuai opsi, bukan mode contoh.

## Rancangan perbandingan titik

- Mulai dengan HP berdampingan untuk mengetahui perbedaan antarperangkat.
- Letakkan pada titik A dan B dengan posisi layar/tab tetap terlihat. Catat penghalang, jarak umum, dan kondisi jaringan; jangan menamai titik “buruk” sebelum data ada.
- Gunakan durasi dan interval yang sama. Tunggu cukup percobaan agar mean dan success% mempunyai denominator yang jelas.
- Tukar posisi HP dan ulangi. Ini membantu memisahkan pengaruh lokasi dari perangkat, tetapi dua perangkat tetap merupakan pilot kecil.
- Catat timeout, sensor hilang, tab tersembunyi, dan akurasi lokasi. Jangan hanya mengekspor sampel yang tampak bagus.
- Perbandingan antarsesi memakai sumber edge, mode sensor, broker, jalur akses, kondisi waktu, dan prosedur yang sama. Broker publik yang sibuk dapat menaikkan latency semua titik.
- Sesi seluler diberi label terpisah; ia bukan sesi satu LAN bila HP memakai jaringan operator berbeda.

## Lembar hasil aktual

Belum ada hasil lapangan yang diisi pada tabel ini. Kolom “diharapkan” adalah kriteria uji, bukan laporan bahwa fitur sudah berhasil di HP kelompok.

| ID  | Langkah                                               | Diharapkan                                                                                   | Hasil aktual | Bukti | Status                   |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------ | ----- | ------------------------ |
| B01 | Buka edge HTTPS pada dua HP, tanpa instalasi aplikasi | Halaman dan form dapat dipakai                                                               | Belum diuji  | —     | Menunggu hardware        |
| B02 | Aktifkan sensor, gerakkan HP A                        | Accelerometer valid; RMS berubah                                                             | Belum diuji  | —     | Menunggu hardware        |
| B03 | Putar HP A, HP B diam                                 | Gyroscope valid; total rotasi HP A berubah                                                   | Belum diuji  | —     | Menunggu hardware        |
| B04 | Jalankan kedua edge pada proyek sama                  | Dua ID/sesi mengirim telemetry riil                                                          | Belum diuji  | —     | Menunggu broker/hardware |
| B05 | Amati probe browser melalui broker                    | Probe berhasil mempunyai latency; timeout tidak menjadi angka buatan                         | Belum diuji  | —     | Menunggu broker/hardware |
| B06 | Kirim sample_now ke HP A                              | ACK ID/sesi cocok; telemetry sesudahnya diperiksa                                            | Belum diuji  | —     | Menunggu broker/hardware |
| B07 | Ubah interval HP B                                    | ACK diterima dan interval berikutnya menyesuaikan                                            | Belum diuji  | —     | Menunggu broker/hardware |
| B08 | Sembunyikan tab HP A                                  | Sesi dijeda; dashboard tidak menganggap data lama segar                                      | Belum diuji  | —     | Menunggu hardware        |
| B09 | Kembali ke tab dan mulai lagi                         | Sesi baru dapat berjalan; perintah sesi lama tidak dieksekusi                                | Belum diuji  | —     | Menunggu hardware        |
| B10 | Tolak izin sensor                                     | UI menjelaskan data sensor tidak tersedia; koneksi tidak disamarkan sebagai bukti dua sensor | Belum diuji  | —     | Menunggu hardware        |
| B11 | Tolak izin lokasi                                     | Tidak ada koordinat palsu; tabel tetap dapat dibaca                                          | Belum diuji  | —     | Menunggu hardware        |
| B12 | Putuskan internet salah satu HP                       | Koneksi berhenti/tidak segar, tanpa keberhasilan atau latency palsu                          | Belum diuji  | —     | Menunggu hardware        |
| B13 | Buka dashboard laptop di LAN bersama                  | Server dashboard berada pada jaringan yang diminta tugas                                     | Belum diuji  | —     | Menunggu LAN             |
| B14 | Pilih contoh lalu kembali ke data riil                | Contoh terpisah; tidak masuk laporan lapangan                                                | Belum diuji  | —     | Menunggu pemeriksaan UI  |
| B15 | Ambil data titik A/B, tukar posisi perangkat          | Data dan konteks dapat dibandingkan tanpa klaim cakupan wilayah                              | Belum diuji  | —     | Menunggu lapangan        |

### Uji khusus Opsi B

| ID | Langkah | Diharapkan | Hasil aktual | Bukti |
|---|---|---|---|---|
| T01 | Jalankan `--check-sensors` pada kedua HP | Dua sensor ditemukan dan menghasilkan sampel nyata | Belum diuji | — |
| T02 | Jalankan hp-a dan hp-b melalui Termux | Dua sumber `termux` muncul pada dashboard | Belum diuji | — |
| T03 | Gerakkan dan putar salah satu HP | RMS/rotasi berubah; gyro rad/s tidak dikonversi dua kali | Belum diuji | — |
| T04 | Kirim command melalui dashboard | ACK perangkat/sesi tepat dan hasil berikutnya dapat diperiksa | Belum diuji | — |
| T05 | Hentikan dengan Ctrl+C, lalu mulai ulang | Status/sesi baru konsisten; perintah sesi lama tidak berjalan | Belum diuji | — |
| T06 | Aktifkan `--share-location` di lokasi uji | Lokasi/akurasi terbaca atau error jujur bila gagal | Belum diuji | — |

Skenario umum dua perangkat, probe, putus koneksi, LAN, dan perbandingan titik diuji pada opsi yang dipilih. Jika keduanya didemonstrasikan, simpan hasil Opsi A dan Opsi B secara terpisah.

### Format catatan sesi

```text
Tanggal/jam/zona waktu:
Penguji:
URL versi HTTPS:
Opsi edge A/B:
Model HP A / OS / browser atau Termux:
Model HP B / OS / browser atau Termux:
Dua sensor terbaca A / B:
Broker endpoint (tanpa kredensial):
ID proyek dan perangkat:
Jaringan akses:
Dashboard laptop satu LAN: ya/tidak
Interval:
Titik dan kondisi lingkungan:
Durasi dan jumlah percobaan selesai:
Probe berhasil / timeout:
Mean / std latency:
Mode RMS percepatan:
RMS / rotasi:
Akurasi dan waktu lokasi:
Command ID / target sesi / ACK:
Jeda tab atau gangguan selama sesi:
Kesimpulan terbatas pada data yang diperoleh:
Lokasi CSV dan video bukti:
```

## Urutan video sekitar 3–5 menit

1. Sebutkan tujuan: membandingkan kualitas koneksi aplikasi melalui broker pada titik terukur.
2. Tunjukkan dua HP menjalankan opsi yang dipilih, dua sensor tersedia, serta laptop pada Wi-Fi bersama.
3. Mulai kedua HP dan tunjukkan ID, sumber `browser`/`termux`, telemetry, dan probe pada dashboard.
4. Gerakkan/putar satu HP; bandingkan hasil olahan dengan HP lainnya.
5. Kirim perintah ke satu HP; tunjukkan ACK dan telemetry sesudahnya.
6. Tunjukkan efek tab tersembunyi atau koneksi terputus, lalu mulai kembali.
7. Tampilkan hasil nyata, keterbatasan, dan tautan GitHub/video.

## Pembagian kerja

| Peran                          | Tugas                                      | Bukti                                  |
| ------------------------------ | ------------------------------------------ | -------------------------------------- |
| Sensor dan HP A                | Izin sensor, RMS/rotasi, pengujian browser | Commit, video sensor, catatan hardware |
| MQTT dan HP B                  | WSS, echo probe, command/ACK, reconnect    | Commit, log pesan dan hasil uji        |
| Dashboard                      | Peta/tabel, status, ekspor, uji mobile     | Commit, tangkapan layar, CSV           |
| Dokumentasi jika empat anggota | Desain uji, PPT, video dan bukti rubrik    | Lembar hasil dan keluaran final        |

Untuk tiga orang, dokumentasi dan video dikerjakan bersama. PDF menyebut deadline satu minggu; tanggal pengumpulan aktual mengikuti kelas.
