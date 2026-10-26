# Opsi B: Termux + Python pada dua HP Android

Gunakan opsi ini bila ingin membaca sensor Android melalui Termux:API. Accelerometer dan gyroscope tetap harus tersedia secara fisik. Data masuk ke dashboard yang sama dengan Opsi A; sumber diberi label `termux`.

## 1. Pasang aplikasi dan paket

Pasang **Termux** dan **Termux:API** dari sumber resmi yang sama agar tanda tangan aplikasi kompatibel. Aplikasi Termux:API dan paket terminal `termux-api` sama-sama diperlukan.

Jalankan pada kedua HP:

```bash
pkg update
pkg install python git termux-api
```

Salin folder revisi ke HP. Jika repository kelompok sudah memuat revisi ini, dapat pula menggunakan:

```bash
git clone https://github.com/faadd/SigHeat.git
cd SigHeat
```

Pastikan `termux_edge.py` benar-benar ada; repository lama tidak otomatis berubah saat ZIP baru diterima.

```bash
pip install -r requirements.txt
cp .env.example .env
```

Berikan izin yang diminta Android/Termux:API. Untuk geolocation opsional, aktifkan layanan lokasi dan izinkan akses lokasi. Selama demo, biarkan Termux aktif agar pembatasan baterai atau proses Android tidak menghentikan sampling.

## 2. Periksa sensor tanpa broker

```bash
python termux_edge.py --check-sensors
```

Pemeriksaan ini bekerja lokal, menemukan nama sensor dan mencoba membaca sampelnya. Ia tidak membutuhkan MQTT/Project ID, dan jalur pemeriksaan menggunakan pustaka standar Python. Dua sensor harus menghasilkan data.

Bila deteksi nama otomatis gagal, lihat daftar:

```bash
termux-sensor -l
```

Lalu gunakan nama persis yang ditampilkan:

```bash
python termux_edge.py --check-sensors --accelerometer "Nama accelerometer" --gyroscope "Nama gyroscope"
```

Nama sensor berbeda antar-HP. Untuk `--accelerometer`, pilih accelerometer mentah yang mencakup gravitasi, bukan linear acceleration, gravity-only, atau uncalibrated; pengolahan Termux mengurangkan magnitude gravitasi. Jangan memilih sensor orientasi dan menganggapnya otomatis identik dengan gyroscope. Jika hardware atau API tidak tersedia, perbaiki izin/perangkat atau gunakan opsi lain; jangan mengganti sampel dengan nilai buatan.

## 3. Isi konfigurasi

Berkas `.env` berada di sebelah `termux_edge.py`. Isinya dibaca edge Termux; dashboard tetap diisi melalui form UI.

```dotenv
PROJECT_ID=sigheat_kelompok_07_uji1
MQTT_WSS_URL=wss://broker.hivemq.com:8884/mqtt
MQTT_USERNAME=
MQTT_PASSWORD=
INTERVAL_S=5
```

Samakan `PROJECT_ID` dan endpoint WSS dengan dashboard. Jika menggunakan broker pribadi, isi kredensial sesuai akun kelompok dan izin topic. Username/password tidak boleh diunggah ke GitHub atau ditampilkan dalam video.

## 4. Jalankan kedua edge

HP A:

```bash
python termux_edge.py hp-a
```

HP B:

```bash
python termux_edge.py hp-b
```

Untuk membagikan lokasi pengamatan yang sesuai:

```bash
python termux_edge.py hp-a --share-location
```

Opsi CLI dapat mengganti konfigurasi tertentu:

```bash
python termux_edge.py hp-a --project sigheat_kelompok_07_uji1 --broker-url wss://broker.hivemq.com:8884/mqtt --interval 5
```

Tambahkan `--accelerometer "Nama persis"` dan `--gyroscope "Nama persis"` bila diperlukan. Tekan **Ctrl+C** untuk berhenti.

Termux:API memberikan snapshot nilai sensor secara berkala; laju keluaran aktual bergantung perangkat dan Android. Program memakai waktu kedatangan keluaran API, karena keluaran ini tidak menyertakan timestamp asli Android SensorEvent. Integrasi rotasi karena itu merupakan pendekatan; nilai yang berulang dapat merupakan cache dan tidak membuktikan kesegaran fisik sensor. Metode ini bukan integrasi instrumen berfrekuensi tinggi. Gyroscope Android memberi radian/detik sehingga **tidak dikonversi lagi dari derajat**. Accelerometer memakai residual magnitude terhadap gravitasi (`gravity_removed`), suatu pendekatan skalar. Bandingkan mode pengolahan dengan jelas jika mencampur sumber browser dan Termux.

## 5. Hubungkan dashboard dan uji

1. Sambungkan dua HP dan laptop ke Wi-Fi/hotspot yang sama untuk demo kelas.
2. Jalankan `python server.py --port 8000` di laptop, lalu buka dashboard.
3. Isi broker WSS dan Project ID yang sama. Dashboard tidak mengambil `.env` HP.
4. Pastikan `hp-a` dan `hp-b` muncul dengan sumber `termux`, dua sensor valid, dan waktu terbaru.
5. Gerakkan/putar satu HP; kirim `sample_now` atau `set_interval` dari dashboard dan periksa ACK serta telemetry sesudahnya.
6. Rekam hasil nyata sesuai [lembar uji](RUBRIC_AND_DEMO.md).

Kedua mode mengukur **roundtrip pesan aplikasi melalui broker**, bukan kekuatan sinyal Wi-Fi/seluler. Termux pada rilis ini bukan jalur pengukuran RSSI/RSRP. WSS dipakai agar endpoint broker sebanding dengan browser.

## Troubleshooting

| Gejala | Pemeriksaan |
|---|---|
| `termux-sensor` tidak ditemukan | Paket terminal `termux-api` sudah dipasang |
| API tidak merespons | Aplikasi Termux:API juga terpasang, sumber tanda tangan cocok, izin aktif |
| Nama sensor gagal ditemukan | `termux-sensor -l`; berikan nama persis melalui CLI |
| Hanya satu sensor terbaca | Periksa hardware/API; syarat dua sensor belum terbukti |
| Sambungan MQTT gagal | Endpoint harus WSS, internet, kredensial, serta ACL |
| Data edge ada tetapi dashboard kosong | Broker dan Project ID sama; dashboard dihubungkan manual |
| Lokasi kosong | Tambahkan `--share-location`, periksa izin/lokasi, tunggu pembacaan |
| Sampel berhenti saat layar mati | Periksa pembatasan baterai/proses Android; gunakan sesi demo aktif |

Referensi: [Termux:API resmi](https://github.com/termux/termux-api). Hasil uji perangkat nyata belum digantikan oleh tes software atau sensor mock.
