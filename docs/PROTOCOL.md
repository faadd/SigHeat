# Protokol SigHeat v2: browser dan Termux

Versi ini menyediakan dua jalur edge: browser HP (`source: browser`) dan Termux + Python Android (`source: termux`). Keduanya memakai kontrak v2 dan mengukur roundtrip aplikasi melalui broker WSS. Payload v1 RSSI/RSRP tidak digunakan. Contoh lokal berlabel simulasi tidak menjadi bukti lapangan.

| Jalur | Cara mulai | Sensor | Konfigurasi |
|---|---|---|---|
| Browser | Tombol mulai di halaman HTTPS | DeviceMotionEvent | Form UI, kredensial sesi |
| Termux | `python termux_edge.py hp-a` | Stream Termux:API accelerometer + gyroscope | `.env` di sebelah script, opsi CLI |

Dua jalur dapat berada dalam satu proyek. Filter “Semua” yang memuat kedua sumber menonaktifkan mean/grid gabungan; pilih satu sumber untuk agregasi. Untuk pengujian awal, gunakan jalur yang sama pada kedua HP; perbandingan lintas jalur harus mencatat perbedaan runtime dan mode sensor.

## 1. Alur browser

1. Pengguna menekan mulai/izin sensor pada halaman HTTPS.
2. Edge mengakses accelerometer dan gyroscope yang tersedia serta lokasi bila pengguna mengizinkan pembagian.
3. Edge menghubungkan MQTT over WSS dan menunggu subscription command dan probe terkonfirmasi.
4. Edge mengirim probe dengan nonce ke topic echo miliknya. Broker meneruskan pesan kepada subscriber, termasuk edge pengirim.
5. Edge menghitung selisih waktu monotonic dari pengiriman sampai nonce yang sama diterima, atau mencatat timeout.
6. Edge menerbitkan telemetri hasil olahan. Dashboard menampilkan dan dapat mengirim perintah terarah.

Pada Termux, alur dimulai dari proses Python yang membaca stream sensor Android, menghubungkan WSS, lalu menjalankan probe dan telemetri dengan kontrak yang sama.

**Roundtrip yang diukur adalah perjalanan pesan aplikasi edge → broker → edge yang sama.** Ia mencakup runtime browser/Python, perangkat, rute jaringan, dan broker. Bukan ICMP ping, RSSI/RSRP, daya radio dBm, atau kecepatan unduh. Echo dari broker tidak membuktikan waktu antar-HP.

## 2. Topic dan identitas

| Topic                                          | Fungsi                              | Retain |
| ---------------------------------------------- | ----------------------------------- | ------ |
| `sigheat/{project}/edge/{device_id}/telemetry` | Hasil pengukuran edge               | Tidak  |
| `sigheat/{project}/edge/{device_id}/status`    | Konteks koneksi/sesi dan Last Will  | Ya     |
| `sigheat/{project}/edge/{device_id}/command`   | Perintah ke edge tertentu           | Tidak  |
| `sigheat/{project}/edge/{device_id}/ack`       | Tanggapan perintah                  | Tidak  |
| `sigheat/{project}/probe/{boot_id}`            | Echo probe untuk sesi edge tersebut | Tidak  |

Project dan device ID menggunakan huruf, angka, `_`, atau `-`, maksimal 48 karakter. `boot_id` membedakan sesi; `sequence` meningkat pada telemetri dalam sesi itu. Gunakan ID perangkat berbeda pada dua HP. Nama proyek unik memisahkan topic, tetapi tidak mengautentikasi peserta.

Dashboard berlangganan telemetry/status/ACK dengan wildcard perangkat. Edge hanya menerima command miliknya dan echo sesi miliknya. Konfirmasi subscription harus diterima sebelum probe dimulai; pesan yang dikirim sebelum subscribe aktif tidak boleh dihitung sebagai kegagalan kualitas jaringan.

## 3. Kontrak telemetri

| Field                               | Tipe/unit                                  | Makna                                                               |
| ----------------------------------- | ------------------------------------------ | ------------------------------------------------------------------- |
| `schema_version`                    | integer `2`                                | Kontrak bersama browser/Termux                                                     |
| `source`                            | `browser` atau `termux`                     | Jalur pembacaan; bukan tanda tangan identitas pengirim              |
| `device_id`, `boot_id`              | string                                     | Perangkat dan sesi                                                  |
| `sequence`, `sent_at_ms`            | integer                                    | Nomor pesan dan Unix timestamp ms                                   |
| `latency_type`                      | `mqtt_app_rtt`                             | Jenis pengukuran koneksi                                            |
| `broker_endpoint`                   | URL WSS                                    | Broker tujuan yang dinormalisasi, tanpa menanam kredensial          |
| `latency_ms`                        | ms atau `null`                             | Roundtrip probe terbaru; `null` saat gagal/timeout                  |
| `latency_mean_ms`                   | ms atau `null`                             | Rata-rata probe berhasil dalam window                               |
| `latency_std_ms`                    | ms atau `null`                             | Simpangan baku latency berhasil dalam window                        |
| `success_pct`                       | persen 0–100                               | Proporsi probe berhasil dari percobaan yang telah selesai di window |
| `probe_count`                       | integer ≤ 10                               | Jumlah percobaan selesai dalam window; bukan total seluruh survei   |
| `probe_ok`                          | boolean                                    | Keberhasilan probe terbaru                                          |
| `accel_rms`                         | m/s² atau `null`                           | RMS percepatan linear atau residual gravitasi sesuai mode           |
| `accel_mode`                        | `linear`, `gravity_removed`, `unavailable` | Cara menghitung percepatan                                          |
| `gyro_rms_rad_s`                    | rad/s atau `null`                          | RMS besar kecepatan putar                                           |
| `rotation_total_rad`                | rad atau `null`                            | Akumulasi besar kecepatan putar terhadap waktu pada window          |
| `accel_available`, `gyro_available` | boolean                                    | Apakah data sensor valid tersedia                                   |
| `accel_samples`, `gyro_samples`     | integer                                    | Jumlah sampel sensor yang digunakan                                 |
| `latitude`, `longitude`             | derajat atau `null`                        | Lokasi opsional dari browser atau Android                                        |
| `accuracy_m`, `location_at_ms`      | meter; Unix ms atau `null`                 | Estimasi akurasi dan waktu lokasi                                   |
| `sensor_window_ms`                  | ms                                         | Rentang waktu sejak snapshot sensor sebelumnya                      |
| `gyro_covered_ms`                   | ms atau `null`                             | Total rentang pasangan sampel gyro yang benar-benar diintegrasikan  |
| `interval_s`                        | 2–60 detik                                 | Target interval; default 5 detik                                    |
| `sensor_errors`                     | array string                               | Diagnosis sensor/izin; bukan nilai pengganti                        |

Nilai `null` bukan nol. Sensor yang belum mengirim data atau datanya lebih tua dari 5 detik dianggap tidak tersedia. Riwayat sensor untuk pemeriksaan kesegaran dibatasi 1.000 sampel, tetapi statistik memakai accumulator seluruh sampel valid sejak snapshot sebelumnya, bukan hanya 1.000 sampel terakhir. Snapshot mereset statistik window. Telemetri tidak boleh menyamarkan data kedaluwarsa sebagai hasil saat ini.

Contoh representasi ini **sintetis untuk format**, bukan hasil pengujian:

```json
{
  "schema_version": 2,
  "source": "browser",
  "device_id": "hp-a",
  "boot_id": "sesi_a_001",
  "sequence": 8,
  "sent_at_ms": 1793000000000,
  "latency_type": "mqtt_app_rtt",
  "broker_endpoint": "wss://broker.hivemq.com:8884/mqtt",
  "latency_ms": 120,
  "latency_mean_ms": 125,
  "latency_std_ms": 8,
  "success_pct": 100,
  "probe_count": 8,
  "probe_ok": true,
  "accel_rms": 0.08,
  "accel_mode": "linear",
  "gyro_rms_rad_s": 0.02,
  "rotation_total_rad": 0.06,
  "accel_available": true,
  "gyro_available": true,
  "accel_samples": 150,
  "gyro_samples": 150,
  "latitude": null,
  "longitude": null,
  "accuracy_m": null,
  "location_at_ms": null,
  "interval_s": 5,
  "sensor_errors": []
}
```

## 4. Processing sensor

`devicemotion` browser menyediakan percepatan dalam m/s² dan `rotationRate` dalam derajat/detik. Browser mengonversi laju putar ke radian/detik. **Gyroscope Termux:API sudah bersatuan radian/detik; nilainya tidak dikalikan π/180 lagi.** Accelerometer Termux menggunakan residual magnitude terhadap gravitasi; browser dapat memakai percepatan linear atau fallback residual.

### RMS accelerometer

Bila percepatan linear valid tersedia:

```text
magnitude_i = akar(ax_i² + ay_i² + az_i²)
accel_rms = akar(rata-rata(magnitude_i²))
accel_mode = linear
```

Bila hanya percepatan yang termasuk gravitasi tersedia:

```text
residual_i = akar(ax_i² + ay_i² + az_i²) − 9.80665
accel_rms = akar(rata-rata(residual_i²))
accel_mode = gravity_removed
```

`gravity_removed` adalah nama mode protokol untuk pendekatan residual magnitude skalar, bukan penghilangan vektor gravitasi penuh. Kedua cara mempunyai karakter berbeda; tampilkan mode dan jangan menyamakan hasil antarperangkat tanpa konteks. Percepatan yang tidak tersedia tidak boleh diganti nilai diam buatan.

### Integrasi rotasi

```text
# Browser: konversi derajat/detik
wx = alpha × π / 180
wy = beta × π / 180
wz = gamma × π / 180
# Termux: wx, wy, wz langsung dari gyroscope dalam radian/detik
omega = akar(wx² + wy² + wz²)
rotation_total_rad = jumlah((omega_sebelumnya + omega_sekarang) / 2 × delta_waktu_detik)
gyro_rms_rad_s = akar(rata-rata(omega²))
```

Integrasi memakai aturan trapesium untuk pasangan sampel berurutan. Jeda lebih dari 0,5 detik dilewati dan ditandai `gyroscope_event_gap`; tanpa pasangan valid, `rotation_total_rad` tetap `null`. `gyro_covered_ms` menunjukkan durasi yang tercakup, sehingga bagian yang hilang tidak tersamar. Hasil total rotasi adalah akumulasi besar gerakan putar dalam window antar-snapshot, bukan heading absolut atau rotasi bersih bertanda. Jeda sampling, pembulatan browser, sensor hardware, serta frekuensi event memengaruhi hasil.

## 5. Processing koneksi

Hanya ada satu probe aktif pada satu waktu. Batas tunggu adalah 5 detik. Window memuat maksimal 10 percobaan selesai.

```text
latency_ms = waktu_terima_monotonic − waktu_kirim_monotonic
mean = jumlah(latency_probe_berhasil) / n_berhasil
std = akar(jumlah((latency_berhasil − mean)²) / n_berhasil)
success_pct = n_berhasil / n_percobaan_selesai × 100
```

Std bernilai `null` bila kurang dari dua probe berhasil; mean bernilai `null` bila tidak ada keberhasilan. Interval merupakan target: saat probe membutuhkan waktu lebih lama, sampling berikutnya menunggu penyelesaian probe. Timeout menambah jumlah percobaan gagal tetapi tidak diubah menjadi angka 5.000 ms dalam mean. Karena mean dihitung dari keberhasilan, selalu baca mean bersama success%, jumlah percobaan, dan `probe_ok` terbaru. Satu nilai lama yang baik tidak boleh menyembunyikan timeout terbaru.

| Kategori heuristik proyek | Syarat                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| Baik                      | Mean ≤ 150 ms dan keberhasilan ≥ 90%                                                               |
| Cukup                     | Mean ≤ 500 ms dan keberhasilan ≥ 70%                                                               |
| Perlu diperiksa           | Selain kondisi di atas; kegagalan probe terbaru ditandai buruk meskipun mean sebelumnya masih baik |
| Belum tersedia            | Belum ada dasar pengukuran yang valid                                                              |

Kategori bukan standar layanan operator dan belum dikalibrasi untuk seluruh browser/broker. Peta mengelompokkan titik secara kasar dalam grid 25 meter dan menampilkan pusat/batas sel. Sampel dengan estimasi akurasi lokasi lebih buruk dari 50 meter tidak masuk grid 25 meter. Grid dipisahkan menurut sumber dan broker; ini agregasi lokasi sampel, bukan interpolasi sinyal atau jaminan ketelitian GPS.

## 6. Command dan ACK

Command diarahkan ke topic perangkat yang dipilih. Gunakan timestamp saat ini, TTL paling lama 30 detik, dan `command_id` unik.

```json
{
  "command_id": "cmd_001",
  "device_id": "hp-a",
  "target_boot_id": "sesi_a_001",
  "action": "sample_now",
  "sent_at_ms": 1793000000000,
  "expires_at_ms": 1793000030000
}
```

Untuk mengubah interval, pakai `action: "set_interval"` dan tambahkan `interval_s`, bernilai 2–60. Command tidak retained. Maksimal 100 ID terbaru dicache agar duplikasi mendapat ACK ulang tanpa menjalankan tindakan dua kali. Perintah baru dibatasi dengan jeda dua detik. `target_boot_id` wajib cocok dengan sesi edge yang sedang berjalan, sehingga command sesi lama tidak dieksekusi setelah restart.

ACK menghubungkan `command_id`, perangkat, action, dan status. **ACK berarti perintah diterima atau ditolak oleh edge, bukan jaminan sensor berhasil.** Untuk `sample_now`, periksa telemetri berikutnya; probe masih dapat timeout dan sensor masih dapat tidak tersedia. Bila satu probe masih berlangsung, aplikasi tidak membuat probe paralel hanya karena tombol ditekan lagi.

Jam sistem yang tidak tepat dapat menyebabkan perintah ditolak karena kedaluwarsa; aktifkan waktu otomatis pada HP/laptop. Aturan payload tidak menggantikan akun/ACL broker.

## 7. Siklus sesi browser

| Status       | Makna                                                           |
| ------------ | --------------------------------------------------------------- |
| `requesting` | Meminta akses sensor dan pilihan lokasi                         |
| `connecting` | Menghubungkan WSS dan menunggu subscription                     |
| `running`    | Subscription siap; pengukuran berlangsung                       |
| `paused`     | Tab tersembunyi; koneksi/listener sensor/lokasi sesi dihentikan |
| `stopped`    | Pengguna menghentikan sesi                                      |
| `error`      | Sesi tidak dapat berjalan; periksa pesan error                  |

Saat layar/halaman tidak terlihat, pengukuran dijeda dan koneksi ditutup agar jadwal background tidak dianggap sebagai latensi jaringan. Pengguna harus menekan mulai lagi setelah kembali; jangan mengklaim pemantauan latar belakang terus-menerus.

`online` dari retained status adalah konteks, bukan bukti data terkini. Last Will dapat terlambat mengikuti mekanisme MQTT; dashboard tetap memeriksa umur telemetri. Versi ini tidak menyediakan database riwayat pusat. Ekspor hasil sesi yang diperlukan sebelum menutup dashboard.

## 8. Jalur Termux dan konfigurasi

`termux_edge.py` memuat `.env` di folder script: `PROJECT_ID`, `MQTT_WSS_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, dan `INTERVAL_S`. ID perangkat diberikan pada CLI (`hp-a`/`hp-b`). Opsi `--check-sensors` memeriksa accelerometer/gyroscope lokal tanpa membutuhkan broker. Opsi `--accelerometer`/`--gyroscope` memilih nama sensor persis; lokasi hanya dikirim setelah `--share-location`.

Termux:API diminta memberi snapshot setiap 100 ms; keluaran aktual dapat berbeda. Pilihan accelerometer khusus harus sensor mentah termasuk gravitasi, bukan linear/gravity-only/uncalibrated. Lokasi opsional diperbarui sekitar 15 detik dan dibuang bila lebih tua dari 60 detik. Termux:API memberi snapshot sensor berkala melalui proses Android. Timestamp integrasi berasal dari waktu kedatangan keluaran API, bukan timestamp asli Android SensorEvent yang tidak tersedia pada keluaran ini. Hasil integrasi adalah pendekatan; keluaran berulang dapat merupakan cache, sehingga program tidak dapat memastikan kesegaran fisik tiap sensor hanya dari pembaruan JSON. Ini bukan pengukuran rotasi instrumen berfrekuensi tinggi. Nama sensor dan izin berbeda antarperangkat. Pengukuran fisik yang tidak tersedia tidak diganti simulator. Runtime tetap perlu diuji pada kedua HP; pembatasan proses Android dapat menghentikan aliran saat aplikasi tidak aktif. Tekan Ctrl+C untuk berhenti. Detail instalasi ada di [ANDROID.md](ANDROID.md).

## 9. Privasi, hosting, dan sumber

Halaman edge membutuhkan secure context; HTTP LAN biasa tidak cukup untuk membaca sensor HP. Dashboard lokal boleh memakai HTTP karena hanya menampilkan/mengirim kontrol, sedangkan edge tetap menggunakan URL HTTPS. Broker harus WSS.

Kredensial browser hanya dipakai selama sesi. Konfigurasi Termux dapat berada pada `.env` lokal; berkas itu tidak boleh diunggah ke repository. Broker publik tidak mengautentikasi ID perangkat; peserta lain dapat membaca/mengirim pada topic yang diketahui. Gunakan broker pribadi dan ACL untuk data lokasi/kelas yang memerlukan pembatasan akses. Geolocation diberikan hanya setelah pilihan/izin pengguna, dan tidak menjamin sumber GPS fisik.

Referensi primer:

- [Device Orientation and Motion, W3C](https://www.w3.org/TR/orientation-event/)
- [DeviceMotionEvent.requestPermission, MDN](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static)
- [Geolocation, W3C](https://www.w3.org/TR/geolocation/)
- [Secure contexts, MDN](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)
- [Termux:API resmi](https://github.com/termux/termux-api)
- [HiveMQ public broker](https://www.mqtt-dashboard.com/)

Format SigHeat, window, dan ambang kategori adalah keputusan desain proyek, bukan standar dari referensi tersebut.
