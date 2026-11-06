# Mulai di sini: SigHeat v5

Versi ini memakai **satu layanan pusat** untuk menyimpan data dan melatih model otomatis. Laptop lain dapat mengambil hasil belajar dari pusat yang sama. Grafik berada di **Rincian pembelajaran & cadangan** pada halaman peta; tidak ada tab training baru.

Untuk percobaan pertama, jalankan pusat di satu laptop. Biarkan laptop itu menyala. HP tetap menjadi perangkat pengukur. Jika pusat harus berjalan ketika laptop tersebut mati, pindahkan pusat ke mesin lain yang terus menyala.

## A. Persiapan sekali di laptop pusat

### 1. Pasang Node.js dan ekstrak proyek

Gunakan **Node.js versi 24 atau lebih baru**. Setelah instalasi, buka terminal di folder yang berisi `package.json`, lalu periksa:

```bash
node --version
npm --version
```

Perintah pertama harus menampilkan `v24...` atau versi yang lebih baru. Python bukan pengganti layanan pusat Node.js. Python tetap digunakan bila memilih edge Termux atau server statis lama.

Pasang dependensi sesuai berkas kunci paket:

```bash
npm ci
```

Langkah ini biasanya hanya diulang setelah mengganti versi proyek atau dependensinya. Sambungan internet diperlukan untuk mengambil dependensi yang belum tersimpan.

### 2. Buat konfigurasi pusat

Salin `.env.central.example` menjadi `.env.central`.

Windows PowerShell:

```powershell
Copy-Item .env.central.example .env.central
```

Linux/macOS:

```bash
cp .env.central.example .env.central
```

Buka `.env.central` dengan editor teks. Untuk percobaan awal, sesuaikan bagian berikut:

```dotenv
SIGHEAT_PROJECT_ID=ABC
SIGHEAT_BROKER_ENDPOINT=wss://broker.hivemq.com:8884/mqtt
SIGHEAT_HOST=127.0.0.1
SIGHEAT_PORT=8787
SIGHEAT_DATA_DIR=./private-data
SIGHEAT_MQTT_USERNAME=
SIGHEAT_MQTT_PASSWORD=
```

`ABC` adalah contoh. Gunakan ID proyek kelompok yang sama pada pusat, dashboard, dan semua HP. Untuk broker pribadi, ganti alamat WSS serta isi username/password bila diperlukan. Jangan memasukkan username/password ke dalam URL broker.

Biarkan konfigurasi GitHub kosong dahulu. Pengumpulan, training pusat, dan grafik lokal tidak memerlukan publikasi GitHub yang aktif.

Folder `private-data` menyimpan data privat pusat. Folder ini bukan aset website dan tidak boleh dimasukkan ke GitHub. Jangan mengubah lokasi data setiap kali demo bila ingin melanjutkan model dan riwayat yang sama.

### 3. Jalankan pusat

```bash
npm run central
```

Biarkan terminal terbuka. Buka dashboard di laptop yang sama:

```text
http://localhost:8787/dashboard.html
```

Dashboard yang disajikan pusat menggunakan konfigurasi pusat. Periksa status layanan dan broker. Pusat yang berjalan tetapi broker belum tersambung belum menerima telemetri HP.

`python server.py` tetap tersedia sebagai server statis lama. Perintah itu **tidak** menjalankan SQLite, pengumpulan pusat, atau training pusat.

## B. Mulai pengukuran pada HP

### Pilihan 1: browser HP

1. Buka halaman kontributor `index.html` dari website SigHeat melalui **HTTPS**. Jika memakai GitHub Pages kelompok, pastikan versi program sudah diterbitkan terlebih dahulu.
2. Samakan **Project ID**, **Broker WSS**, dan **interval** dengan percobaan kelompok. Misalnya interval 5 detik.
3. Gunakan ID berbeda: `hp-masir`, `hp-farrel`, dan `hp-addia`.
4. Isi kredensial broker jika broker memerlukannya.
5. Aktifkan pembagian lokasi jika ingin titik HP muncul pada peta/heatmap.
6. Tekan **Mulai pengukuran**. Izinkan sensor dan lokasi yang diminta.
7. Pertahankan tab pengukur terlihat. Ikuti status layar/izin yang ditampilkan aplikasi. Browser bukan layanan sensor yang dijamin terus berjalan setelah tab ditutup.

Titik peta memerlukan lokasi yang valid dan diizinkan. Data tanpa lokasi masih dapat dipakai pada tabel serta pembelajaran jika fitur lainnya memenuhi syarat.

### Pilihan 2: Termux pada Android

Termux menjalankan pengukur Python sehingga tidak bergantung pada tab browser. Persiapan sensor dan izin ada di [Panduan Android](ANDROID.md). Setelah dependensi, `.env`, dan izin sensor siap, contoh menjalankan pengukur dengan wake lock adalah:

```bash
bash scripts/termux-run.sh hp-masir
```

Gunakan ID HP masing-masing. Pengoperasian sebagai layanan Android, sambungan ulang, serta batas layar mati dijelaskan di [Ketersediaan perangkat](AVAILABILITY.md). Wake lock membantu menjaga proses ketika didukung; Android tetap dapat menghentikannya.

Jangan menjalankan dua pengukur aktif dengan `device_id` yang sama. Jika mengganti sumber Browser ke Termux, sistem memperlakukannya sebagai konteks berbeda agar karakteristik pengukuran tidak tercampur.

## C. Buka dashboard dan pastikan data masuk

Pada dashboard, hubungkan MQTT ke proyek dan broker yang sama jika belum terhubung. Pilih perangkat yang ingin diamati.

Periksa hal berikut:

- `device_id` setiap HP muncul dan berbeda.
- Waktu pengamatan serta urutan data terus bertambah.
- RTT terisi ketika probe berhasil; timeout tetap terlihat sebagai gagal/nilai yang tidak tersedia.
- Status pusat menunjukkan penerimaan data, bukan hanya status MQTT dashboard.
- Sumber model menunjukkan mode pusat ketika mode tersebut dipilih.

**Tabel bergerak saja belum membuktikan pusat menyimpan data.** Dashboard menerima MQTT melalui jalurnya sendiri. Periksa juga jumlah data dan waktu pembaruan pusat pada panel pembelajaran.

Jangan memakai **Contoh lokal** sebagai bukti pengukuran nyata. Data contoh tetap terpisah dan tidak melatih model nyata pusat.

## D. Penggunaan rutin berikutnya

Pada sesi berikutnya, jalankan kembali:

```bash
npm run central
```

Gunakan `.env.central` dan folder data yang sama. Nyalakan pengukur HP, lalu buka dashboard. Tidak perlu menjalankan `train-ml.cjs` atau menekan tombol training.

Model dan riwayat yang sudah tersimpan dilanjutkan oleh pusat. Sesi HP yang baru tetap membutuhkan enam RTT berurutan yang valid untuk membuat prediksi berikutnya. Sistem tidak menyambungkan enam lag melintasi reboot/jeda.

Menutup dashboard tidak menghentikan pengumpulan pusat. Menutup terminal layanan pusat atau mematikan mesin pusat akan menghentikan pusat sampai dijalankan kembali.

## E. Apa yang berlangsung otomatis?

1. Pusat menerima dan memvalidasi telemetri.
2. Data yang layak disimpan; pesan duplikat tidak menggandakan hitungan.
3. Setelah enam RTT berurutan tersedia, prediksi dapat dibuat dan dicatat sebelum target tiba.
4. Setelah syarat jumlah data serta pasangan valid cukup, pusat melatih kandidat Ridge/K-Means.
5. Kandidat dibekukan dan dibandingkan pada 24 target/profil baru yang valid.
6. Kandidat yang memenuhi margin perbaikan dapat dipromosikan. Kandidat yang belum memenuhi syarat tetap dicatat sebagai ditolak.
7. Bila publikasi dikonfigurasi, perubahan model/metode yang layak dipublikasikan masuk antrean GitHub.
8. Dashboard memeriksa pembaruan model secara berkala, dengan interval awal 60 detik.

Ridge mulai mencoba training setelah sedikitnya 120 baris pada konteks yang sama. K-Means mulai mencoba setelah sedikitnya 90 baris pada konteks bersama dan mempunyai sedikitnya 60 profil lengkap. Pada interval 5 detik, 120 pesan tanpa gangguan kira-kira 10 menit, kemudian masih perlu evaluasi berikutnya. Ini bukan jaminan waktu promosi.

**`promoted: false` tidak berarti sistem belum training.** Itu dapat berarti kandidat sudah dilatih dan diuji, tetapi belum cukup baik dibanding pembanding. Metode prediksi juga dapat memakai baseline jika lebih sesuai; periksa nama metode yang benar-benar aktif.

## F. Melihat bukti belajar dan grafik

Buka **Peta koneksi → Rincian pembelajaran & cadangan**. Panel ini berada di bawah bagian perangkat pengukuran, sesuai area yang ditandai pada gambar percakapan.

Pilih konteks perangkat, rentang waktu, dan filter yang diperlukan. Zona waktu awal adalah **Asia/Jakarta**; perhatikan zona ini saat mencocokkan log dengan catatan demo.

| Tampilan | Cara membacanya |
|---|---|
| RTT aktual dan prediksi | Bandingkan prediksi yang dibuat sebelum target dengan RTT yang kemudian terukur |
| MAE blok 24 target | Tiap titik adalah 24 target valid yang tidak bertumpang tindih; lebih kecil berarti galat lebih kecil pada blok tersebut |
| Model awal beku | Pembanding sintetis yang tidak ikut berubah, dinilai pada target yang sama |
| Kandidat | Lihat MAE kandidat, metode aktif, baseline, ambang 5%, keputusan, dan alasan |
| Riwayat versi | Periksa perubahan model/metode serta tahap publikasinya |
| K-Means | Bandingkan rata-rata jarak kuadrat kandidat dan aktif; ini bukan akurasi klasifikasi berlabel |

Grafik awal dapat kosong. Tunggu pengamatan baru; blok MAE pertama memerlukan 24 target yang dapat dipasangkan setelah prediksi valid tersedia. Data lama yang tidak mempunyai catatan prediksi sebelum target tidak diubah menjadi kurva live buatan.

MAE 12 ms berarti rata-rata selisih absolut 12 ms. Jangan menyebutnya “akurasi 88%”. Grafik boleh naik; kondisi jaringan berubah dan model belum tentu membaik pada setiap kandidat. Bandingkan model adaptif dengan model awal beku serta baseline pada target yang sama.

Gunakan ekspor log CSV, metadata JSON, dan grafik SVG untuk laporan. Simpan juga rentang waktu, jumlah target valid, konteks, versi model, serta timeout/pengecualian. Bukti lengkap lebih kuat daripada satu tangkapan layar angka terakhir.

Contoh penjelasan saat presentasi:

> “Pengukuran HP dikumpulkan pada layanan pusat. Dari enam RTT sebelumnya, sistem membuat prediksi RTT berikutnya dan menyimpannya sebelum pengukuran target datang. Jika data cukup, sistem melatih kandidat secara otomatis, lalu membandingkannya pada 24 target baru. Grafik ini memperlihatkan galat yang benar-benar tercatat. Kandidat hanya menggantikan pembanding jika memenuhi margin perbaikan, sehingga belajar tidak berarti setiap model baru pasti diterima.”

## G. Memakai dashboard dari laptop lain

Alamat `localhost` selalu menunjuk perangkat yang sedang membuka halaman. Jadi, `http://localhost:8787` pada laptop B tidak menunjuk pusat pada laptop A.

Untuk penggunaan antarlaptop, pusat harus mempunyai alamat yang dapat dijangkau. Pada layanan yang diakses dari luar mesin pusat:

- Gunakan alamat **HTTPS** yang benar untuk akses dashboard HTTPS/GitHub Pages.
- Atur host/binding dan firewall sesuai jaringan yang dipakai.
- Isi `SIGHEAT_PUBLIC_URL`, misalnya `https://central.example.com`, ketika memakai reverse proxy. Gunakan origin tanpa path dan tanpa garis miring di akhir; domain contoh harus diganti dengan domain yang benar.
- Isi token baca pusat yang kuat pada konfigurasi server. Binding non-loopback memerlukan token baca sedikitnya 24 karakter.
- Batasi `SIGHEAT_ALLOWED_ORIGINS` ke origin website yang diizinkan, misalnya `https://faadd.github.io`; origin tidak memakai `/SigHeat/` di belakangnya.
- Buka **Rincian pembelajaran & cadangan → Atur layanan pusat**, pilih **Terpusat**, isi **URL layanan pusat** dan **Kunci baca API**, lalu tekan **Simpan koneksi pusat**. Token baca ini bukan token GitHub dan hanya disimpan selama sesi tab.

Jangan menganggap API HTTP lokal dapat otomatis dibaca halaman HTTPS publik. Untuk percobaan paling sederhana, gunakan dashboard yang disajikan pusat pada laptop pusat dahulu. Untuk pusat yang terus aktif, tersedia `deploy/sigheat-central.service` untuk Linux, `compose.yaml` untuk Docker dengan volume data persisten, serta `deploy/Caddyfile.example` untuk reverse proxy HTTPS. Sesuaikan nama domain dan path dengan mesin pengguna; berkas contoh tidak berarti server sudah terpasang.

Dashboard Pages yang baru dibuka memakai mode **Terpusat** dan memeriksa `models/latest.json` dari website yang sama. Pada instalasi awal, paket ini berisi bootstrap sintetis, belum model hasil pengukuran kelompok. Setelah model terpilih diterbitkan, dashboard mengambil versi yang kompatibel tanpa training browser.

API pusat tetap perlu diatur untuk melihat riwayat grafik bersama. Jika sebelumnya memilih mode lokal, kembalikan pilihan ke **Terpusat**. Isian **Manifest model terbitan (opsional)** dapat menentukan sumber parameter Pages secara eksplisit. API dan sumber parameter publik mempunyai fungsi berbeda; memuat model saja tidak mengunduh seluruh arsip evaluasi.

Dua dashboard pada konteks yang sama seharusnya memperlihatkan versi model yang sama setelah sinkronisasi berhasil. Periksa waktu sinkronisasi dan asal model. Jika pusat sedang tidak tersedia, dashboard dapat memakai cache valid terakhir; status ini harus dibedakan dari model pusat terkini.

### Pilihan layanan Docker

Gunakan ini bila Docker sudah terpasang pada mesin yang akan menjadi pusat. Hentikan pusat yang dijalankan langsung dengan Node terlebih dahulu agar port dan penulis proyek tidak ganda.

1. Isi `.env.central` seperti sebelumnya. Tambahkan `SIGHEAT_READ_TOKEN` dengan nilai acak sedikitnya 24 karakter; jangan memakai contoh teks pendek sebagai token.
2. Jalankan:

```bash
docker compose up --build -d
docker compose logs -f central
```

3. Buka `http://localhost:8787/dashboard.html`. Isi **Kunci baca API** pada pengaturan pusat sesuai konfigurasi.
4. Untuk menghentikan tanpa menghapus data, jalankan `docker compose stop central`. Untuk menjalankan kembali, gunakan `docker compose up -d`.

Compose menyimpan data pada volume `sigheat-data`, bukan folder `private-data` pada komputer host. Jangan menggunakan `docker compose down -v` bila ingin mempertahankan model dan riwayat; opsi `-v` menghapus volume.

Port contoh hanya dibuka pada localhost mesin Docker. Akses publik/laptop lain memerlukan reverse proxy HTTPS yang dikonfigurasi, misalnya contoh Caddy, serta origin dashboard yang diizinkan. `restart: unless-stopped` membantu menyalakan ulang proses; ia tidak membuat komputer yang mati tetap bekerja.

Untuk backup database Docker, jalankan alat yang sama **di container**, lalu salin hasilnya keluar:

```bash
docker compose exec central node scripts/central-admin.cjs backup --output /var/lib/sigheat/backups/sigheat-demo.sqlite
docker compose cp central:/var/lib/sigheat/backups/sigheat-demo.sqlite ./sigheat-demo.sqlite
```

Pilih nama backup baru pada setiap sesi dan simpan hasil salinannya secara privat. Untuk pemulihan, hentikan container, tempatkan backup pada volume yang sesuai, lalu jalankan alat restore menggunakan konfigurasi/volume yang sama. Jangan menjalankan perintah backup host terhadap `./private-data` dan menganggap itu database Docker.

### Pilihan layanan Linux

Contoh `deploy/sigheat-central.service` memakai pengguna sistem `sigheat`, kode di `/opt/sigheat`, data di `/var/lib/sigheat`, dan Node di `/usr/bin/node`. Buat pengguna/folder tersebut serta pasang dependensi terlebih dahulu. Pastikan `.env.central` menggunakan `SIGHEAT_DATA_DIR=/var/lib/sigheat`, dan sesuaikan path Node jika berbeda.

Setelah file layanan dan izin siap:

```bash
sudo cp deploy/sigheat-central.service /etc/systemd/system/sigheat-central.service
sudo systemctl daemon-reload
sudo systemctl enable --now sigheat-central
sudo systemctl status sigheat-central
```

Log dapat dibaca melalui `journalctl -u sigheat-central -f`. Hentikan layanan sebelum restore/rollback dengan `sudo systemctl stop sigheat-central`, lalu jalankan kembali setelah selesai. Mesin dan jaringan tetap harus aktif.

Semua algoritma pada proyek berjalan tanpa API AI berbayar. Penggunaan mesin sendiri dapat menghindari biaya sewa server; biaya listrik, internet, domain, atau hosting tetap bergantung pilihan pengguna.

## H. Publikasi model ke GitHub dan Pages

Publikasi bersifat opsional untuk penggunaan lokal, tetapi diperlukan bila ingin paket model terpilih tersedia melalui repository/Pages.

Konfigurasi terkait meliputi:

```dotenv
SIGHEAT_GITHUB_REPOSITORY=faadd/SigHeat
SIGHEAT_GITHUB_BRANCH=main
SIGHEAT_PAGES_URL=https://faadd.github.io/SigHeat/
SIGHEAT_GITHUB_TOKEN=
```

Isi token hanya pada mesin pusat melalui lingkungan privat. Jangan menempelkan token ke percakapan, memasukkannya ke JavaScript, atau meng-commit `.env.central`. Ikuti [panduan publikasi](PUBLISHING.md) untuk hak token, workflow, pemeriksaan status, retry, dan rollback.

Perbedaan yang perlu diperhatikan:

- **Pusat aktif:** model/metode sudah dipakai layanan pusat.
- **Commit berhasil:** parameter sudah tersimpan di GitHub.
- **Pages tersedia:** workflow deployment selesai dan manifest terbit dapat diambil.
- **Dashboard sinkron:** dashboard ini sudah mengambil serta memvalidasi paket tersebut.

Keempat keadaan ini bisa memiliki waktu berbeda. Publikasi yang gagal tidak berarti training pusat dibatalkan, tetapi dashboard yang membaca Pages belum tentu memperoleh model terbaru.

## I. Backup dan pemulihan

### Buat backup pusat

Simpan backup pada lokasi privat di luar folder aset website:

```bash
npm run central:backup -- --output /lokasi-privat/sigheat-backup.sqlite
```

Ganti `/lokasi-privat/...` dengan path yang benar pada komputer. Di Windows, misalnya `D:\Cadangan-SigHeat\sigheat-backup.sqlite`. Pilih nama baru untuk setiap backup; alat menolak menimpa tujuan yang sudah ada.

Database bawaan adalah `private-data/sigheat.sqlite`. Perintah backup membuat salinan SQLite yang konsisten dan dapat dijalankan ketika pusat aktif. Untuk menyimpan arsip publikasi secara lengkap, simpan juga folder `private-data/models` dan `private-data/publication`; untuk salinan folder yang konsisten, hentikan pusat dahulu. Buat salinan `.env.central` secara terpisah pada tempat aman; file tersebut dapat berisi rahasia.

Backup pusat berbeda dari cadangan pembelajaran browser v4. Gunakan alat backup yang disediakan untuk database, terutama saat layanan aktif. Jangan menyalin hanya berkas SQLite utama secara sembarang ketika transaksi/WAL masih berjalan.

### Pulihkan database

1. Hentikan layanan pusat terlebih dahulu dengan `Ctrl+C` atau pengelola layanan.
2. Simpan backup keadaan sekarang jika masih dapat dibaca.
3. Jalankan:

```bash
npm run central:restore -- --input /lokasi-privat/sigheat-backup.sqlite
```

4. Jalankan kembali `npm run central` dengan konfigurasi yang sama.
5. Periksa konteks, versi model, jumlah data, dan waktu evaluasi yang dipulihkan.

Pemulihan menyimpan salinan database sebelumnya dan menonaktifkan antrean publikasi lama agar antrean dari keadaan yang sudah diganti tidak diteruskan diam-diam. Ketika pusat dijalankan kembali, paket model dibangun dari database hasil pemulihan.

Jangan menjalankan dua pusat penulis pada database/proyek yang sama. Setelah pemulihan, data yang tidak pernah diterima pusat tetap tidak dapat dianggap sebagai hasil pengukuran tersimpan.

### Retensi

Buffer training dibatasi agar proses tetap terjangkau. Arsip database dan riwayat evaluasi tidak dihapus hanya karena buffer training berputar. Pantau ruang disk dan buat backup berkala. Versi ini tidak otomatis menghapus arsip lama berdasarkan umur.

### Mengembalikan parameter model

Hentikan pusat, pilih versi artefak yang memang tersedia dalam arsip pusat, lalu jalankan:

```bash
npm run central:rollback -- --version model-VERSI --reason "Alasan mengembalikan model"
npm run central
```

Ganti `model-VERSI` dengan versi yang tercatat. Rollback memulihkan parameter pusat dan membuat paket publikasi baru. Data serta bukti evaluasi sejarah tetap dipertahankan; konteks baru yang tidak ada pada artefak lama tidak otomatis dihapus. Rincian ada di [panduan publikasi](PUBLISHING.md).

Jika antrean publikasi berhenti setelah gagal berulang, perbaiki kredensial/koneksi, hentikan pusat, lalu gunakan `npm run central:retry` dan jalankan pusat lagi. Retry bukan perintah training.

## J. Jika belum bekerja

| Gejala | Pemeriksaan pertama |
|---|---|
| `npm run central` gagal | Node.js minimal 24, `npm ci` selesai, `.env.central` ada, port tidak dipakai proses lain |
| Dashboard terbuka tetapi pusat tidak menerima data | Status koneksi MQTT pusat, project/broker sama, topic benar, HP sedang mengukur |
| Tabel bergerak tetapi grafik pusat kosong | Koneksi API pusat, konteks terpilih, bukti prediksi baru sudah terkumpul, bukan mode contoh |
| Prediksi belum ada | Enam RTT berurutan valid; tidak terputus reboot/gap/timeout; konteks cocok |
| Training belum muncul | Jumlah data per konteks dan pasangan valid cukup; total semua HP bukan otomatis jumlah untuk satu Ridge |
| Banyak target tidak masuk evaluasi | Periksa waktu otomatis pada HP/mesin pusat, timeout, reboot, celah urutan, dan alasan pengecualian; jam yang tidak selaras dapat membuat target ditolak |
| Kandidat ditolak | Baca metrik dan ambang; penolakan adalah hasil evaluasi yang sah |
| Model masih `synthetic` | Bootstrap masih aktif atau belum ada model nyata yang lolos; jangan menyebutnya hasil jaringan nyata |
| Browser lain berbeda versi | URL pusat/manifest, konteks, waktu sinkronisasi, cache, dan status publikasi |
| HP tidak aktif | HP/aplikasi berjalan, tab terlihat untuk browser, izin sensor, internet, dan broker tersedia |
| GitHub berhasil tetapi website belum berubah | Workflow Pages, versi manifest yang terbit, dan interval pemeriksaan dashboard |
| Pusat mati sementara | Jalankan kembali; data tersimpan dipertahankan, pesan yang tidak diterima selama mati tidak diciptakan ulang |

## K. Menguji sebelum presentasi

Lakukan percobaan singkat dengan perangkat nyata:

1. Jalankan pusat dan dua atau tiga HP dengan konfigurasi yang sama.
2. Periksa data masuk ke pusat serta dashboard.
3. Tutup dashboard selama beberapa saat; biarkan pusat dan HP berjalan.
4. Buka kembali dashboard dan periksa riwayat pusat bertambah pada waktu dashboard ditutup.
5. Buka dashboard dari browser/laptop kedua yang dapat mengakses pusat; bandingkan versi model pada konteks yang sama.
6. Tunggu kandidat dan evaluasi baru; ekspor log serta periksa MAE, keputusan, dan jumlah target.
7. Simpan backup sebelum menghentikan sesi.

Tes otomatis paket memeriksa perilaku program dengan fixture. Tes tersebut tidak menggantikan pengukuran HP, koneksi broker kelompok, atau verifikasi deployment akun pengguna. Baca [laporan validasi v5](VALIDASI_V5.md) untuk mengetahui apa yang sudah diuji dan apa yang masih perlu diuji pada lingkungan kelompok.
