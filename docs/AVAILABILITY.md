# Tetap mengukur, menyambung kembali, dan batas perangkat

**HP yang mati total tidak bisa terhubung atau mengirim pengukuran.** Data/model yang sudah masuk pusat tetap tersimpan. Ketika HP kembali menyala dan edge dijalankan, pengukuran baru dapat dilanjutkan. Waktu tanpa pengukuran tidak diisi dengan RTT buatan.

| Keadaan | Yang terjadi pada versi ini |
|---|---|
| Tab dashboard laptop ditutup | Pusat tetap mengumpulkan data dan melatih model jika layanan pusat, broker, dan HP masih aktif. |
| Laptop dashboard mati, pusat ada di mesin lain | Layanan pusat tetap berjalan di mesin lain. |
| Laptop yang juga menjalankan pusat mati/sleep | Pengumpulan pusat berhenti. Database/model di disk tidak otomatis hilang; lanjutkan layanan setelah laptop aktif. Pesan QoS 0 yang terlewat tidak direkonstruksi. |
| Tab pengukuran HP terlihat | Browser mengukur; pilihan penahan layar mencoba menjaga layar menyala. |
| Tab pengukuran browser tersembunyi | Pengukuran dijeda, MQTT dilepas, dan tidak ada klaim masih terhubung. Saat tab terlihat lagi, sesi baru mulai otomatis. |
| Tab pengukuran browser ditutup | Pengukuran berhenti. Buka lagi dan tekan **Mulai pengukuran**. Kredensial tidak disimpan untuk memulai diam-diam. |
| Internet putus, halaman masih terlihat | Browser mencoba menyambung kembali dengan jeda 1, 2, 4, 8, 16, lalu maksimum 30 detik. Status tetap menyambung ulang sampai koneksi dan langganan dikonfirmasi. |
| Browser ditutup, edge Termux berjalan | Termux bekerja terpisah dari browser. Dapat tetap mengukur selama Android tidak menghentikan proses/sensor/jaringan. |
| HP benar-benar mati | Tidak ada pengukuran; perangkat akan tidak aktif setelah pemeriksaan kesegaran dashboard. |

Status tidak selalu berubah seketika: putus mendadak dapat baru diketahui setelah keepalive broker atau batas umur pengamatan. Pesan status lama bukan bukti pengukuran masih aktif.

## Browser: cara paling mudah untuk demo

1. Buka halaman kontributor HTTPS pada setiap HP. Samakan Project ID, broker, dan interval; bedakan Device ID.
2. Biarkan **Jaga layar tetap menyala jika didukung browser** tercentang, lalu tekan **Mulai pengukuran**. Izinkan sensor/lokasi sesuai kebutuhan.
3. Pertahankan tab pengukuran terlihat. Perhatikan pesan di bawah pilihan penahan layar: browser boleh menolak atau melepas wake lock karena penghematan baterai.
4. Jika pindah tab sebentar, kembali ke tab pengukuran. Program memulai sesi baru otomatis, menggunakan izin sensor yang sudah diberikan. Enam lag RTT dikumpulkan kembali; jendela tidak melewati jeda.
5. Tekan **Hentikan** untuk benar-benar menghentikan sesi dan percobaan koneksi ulang. Untuk mengubah penahan layar atau konfigurasi, hentikan dulu.

Wake lock bukan layanan latar belakang dan bukan izin untuk bekerja ketika HP mati. Jika browser membuang halaman dari memori, halaman perlu dimulai ulang secara manual. API sensor tetap bergantung pada dukungan HP/browser.

## Android: pengukuran melalui Termux

Ini pilihan untuk pengukuran saat layar mati atau saat browser ditutup. Pilih satu edge per Device ID; jangan menjalankan browser dan Termux bersamaan dengan ID yang sama. Sumber `browser` dan `termux` memiliki konteks model terpisah.

### Persiapan satu kali

Pasang Termux dan Termux:API dari sumber yang sama, buka keduanya, dan beri izin yang diperlukan. Ekstrak proyek ke penyimpanan privat Termux, misalnya `~/SigHeat`, lalu jalankan di folder proyek:

```sh
pkg update
pkg install python termux-api
python -m pip install -r requirements.txt
cp .env.example .env
```

Isi `.env` pada HP tersebut, terutama `PROJECT_ID`, `MQTT_WSS_URL`, dan `INTERVAL_S`. Akun/password broker hanya jika broker membutuhkannya. Jangan unggah `.env` atau menempelkan token ke chat. Periksa sensor tanpa menghubungi broker:

```sh
python termux_edge.py --check-sensors
```

### Mulai dan hentikan

```sh
bash scripts/termux-run.sh hp-masir
```

Pada HP lain gunakan ID lain, misalnya `hp-farrel`. Skrip menahan CPU melalui `termux-wake-lock`, menjalankan Python, dan melepas wake lock saat berhenti. Tekan **Ctrl+C** untuk berhenti. Tambahkan `--share-location` jika ingin mengirim koordinat untuk peta.

Paho menyambung ulang otomatis dengan jeda maksimum 30 detik jika jaringan terputus. Sampel tidak dibuat selama transport putus. Setelah tersambung ulang, program membuat celah urutan dan mengosongkan statistik probe/sensor lama agar pembelajaran tidak menyambung lag melewati gangguan. Akun/ACL yang ditolak tetap ditampilkan sebagai kegagalan untuk diperbaiki.

Biarkan notifikasi/proses Termux berjalan. Bila pengukuran berhenti saat layar mati, periksa pengaturan baterai/background Termux dan Termux:API di Android. Nama menu berbeda antarprodusen. Wake lock menambah pemakaian baterai dan tidak menjamin Android tidak akan menghentikan aplikasi. Jangan pakai **Force stop** atau membersihkan proses Termux selama sesi.

### Layanan latar belakang yang dapat dimulai ulang

Jika ingin proses dikelola `runit`, pasang layanan yang sudah disediakan:

```sh
pkg install termux-services
bash scripts/install-termux-service.sh hp-masir
```

Tutup lalu buka sesi shell Termux sesudah pertama memasang `termux-services`, agar pengelola layanan aktif. Konfigurasi tetap dibaca dari `.env` folder proyek; jangan pindahkan folder saat layanan digunakan. Instalasi tidak langsung memulai pengukuran. Mulai dengan:

```sh
sv-enable sigheat-edge
sv up sigheat-edge
sv status sigheat-edge
tail -f ~/.local/state/sigheat-edge/log/current
```

Status `run` menunjukkan proses layanan, bukan bukti MQTT sudah tersambung. Cari pesan konfirmasi langganan MQTT dan pastikan `sent_at_ms`/sequence di dashboard terus bertambah. Log layanan dirotasi sekitar 1 MB per berkas dengan lima arsip.

Untuk menghentikan dan menonaktifkan pengukuran:

```sh
sv-disable sigheat-edge
```

`sv down sigheat-edge` menghentikan sementara; `sv-enable` mengizinkannya mulai pada pengelola layanan berikutnya. Jika konfigurasi salah, hentikan, perbaiki `.env`, lalu hidupkan lagi. Jangan menjalankan skrip manual bersamaan dengan layanan.

### Opsional: mulai setelah Android reboot

Pasang **Termux:Boot** dari sumber yang sama dengan Termux, lalu buka aplikasinya sekali. Setelah layanan di atas sudah diuji dan diaktifkan, jalankan:

```sh
mkdir -p ~/.termux/boot
cp scripts/service/termux-boot.sh ~/.termux/boot/start-sigheat-services
chmod 700 ~/.termux/boot/start-sigheat-services
```

Ini memulai pengelola layanan setelah Android menyala; bukan membuat HP yang mati tetap tersambung. Periksa kembali pada HP sebenarnya karena kebijakan background/boot pabrikan dapat membatasi proses. Untuk membatalkan otomatisasi ini, nonaktifkan layanan dan hapus hanya skrip `~/.termux/boot/start-sigheat-services` yang tadi disalin.

## Memeriksa hasil tanpa menganggap offline sebagai online

- Putuskan jaringan HP sementara: status edge harus menyambung ulang, tidak terus menampilkan pengukuran baru. Sambungkan kembali dan periksa sequence/waktu baru.
- Pindahkan tab browser: status dijeda; saat kembali koneksi/sesi dibuat lagi. Tutup tab sepenuhnya: tidak ada pengukuran browser sampai dimulai lagi.
- Tutup semua dashboard sambil pusat dan HP aktif. Setelah membuka dashboard lagi, periksa bertambahnya catatan API pusat; ini membuktikan pengumpulan tidak bergantung pada tab dashboard.
- Untuk Termux, matikan layar beberapa menit dan periksa waktu pengamatan di laptop lain. Jika berhenti, periksa log, izin, serta pengaturan baterai HP. Pengujian perangkat lunak dalam paket tidak menggantikan pengujian ini.

## Rujukan platform

- [Screen Wake Lock API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API): wake lock hanya untuk dokumen aktif/terlihat dan dapat dilepas sistem.
- [Page Lifecycle — Chrome](https://developer.chrome.com/docs/web-platform/page-lifecycle-api): halaman dapat dibekukan atau dibuang oleh browser.
- [Paho Python client](https://eclipse.dev/paho/files/paho.mqtt.python/html/client.html): reconnect dan jeda eksponensial.
- [Termux services](https://github.com/termux/termux-services): pengelola layanan runit.
- [Termux:Boot](https://github.com/termux/termux-boot): menjalankan skrip setelah boot, dengan aplikasi tambahan.
