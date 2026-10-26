# Perubahan SigHeat: dua opsi edge

Struktur README kini mengikuti contoh PocketGuard yang dilampirkan: pengantar, anggota kelompok, cara kerja, laptop, pilihan Opsi A/Opsi B, uji sistem, dan peta kode. Fungsi tetap SigHeat untuk pengamatan kualitas koneksi.

## Dua alternatif yang tersedia

| Opsi | Cara menjalankan | Sensor | Sumber telemetry |
|---|---|---|---|
| A: Browser | Buka halaman HTTPS, isi form, tekan mulai | Accelerometer dan gyroscope melalui DeviceMotionEvent | `browser` |
| B: Termux + Python | Dua Android menjalankan `termux_edge.py hp-a` dan `hp-b` | Accelerometer dan gyroscope melalui Termux:API | `termux` |

Kedua opsi memakai MQTT WSS, schema v2, probe aplikasi, command, ACK, dan dashboard yang sama. Opsi A tidak memerlukan instalasi tambahan di HP. Opsi B memerlukan Termux, Termux:API, Python, dan dependensi edge.

## Perubahan utama

- README menambahkan tiga placeholder nama/NIM; identitas tidak ditebak dari percakapan.
- Panduan browser dan Termux dipisahkan menjadi `BROWSER_EDGE.md` dan `ANDROID.md`.
- Edge Termux memakai `.env` lokal atau CLI. Dashboard tetap diisi melalui UI dan tidak mengklaim membaca `.env` secara otomatis.
- Jalur Termux memiliki pemeriksaan dua sensor lokal melalui `--check-sensors` sebelum koneksi cloud.
- Gyroscope browser memakai derajat/detik lalu dikonversi; gyroscope Android pada Termux sudah radian/detik.
- Dashboard menandai sumber. Saat sumber berbeda dicampur pada filter “Semua”, mean/grid gabungan dinonaktifkan agar hasil lintas runtime tidak disamakan diam-diam.
- Semua catatan “README contoh belum terverifikasi” diganti dengan acuan README yang benar-benar dilampirkan dan dibaca.

## Lingkup yang dipertahankan

SigHeat mengukur roundtrip **pesan aplikasi melalui broker**, bukan RSSI/RSRP, kekuatan radio dBm, ping ICMP, atau throughput. Sensor gerak menyediakan dua sensor fisik dan dua processing; lokasi memberi konteks titik.

Fitur alarm anti-pencurian PocketGuard dan Sensor Playground umum tidak disalin menjadi fitur SigHeat. Mode contoh tetap berlabel simulasi; tidak menjadi bukti dua HP fisik.

## Batas dan status

- Dua sensor perlu diuji pada kedua HP, baik browser maupun Termux. Hasil hardware/broker nyata belum dianggap lulus dari tes mock.
- Browser membutuhkan HTTPS dan berhenti/jeda saat tab tersembunyi; pengguna mulai kembali saat kembali.
- Termux menggunakan snapshot API dan waktu kedatangan keluaran, bukan timestamp Android SensorEvent. Integrasi rotasi bersifat pendekatan; nilai berulang tidak memastikan kesegaran sensor fisik.
- Broker dan runtime memengaruhi latency. Untuk perbandingan awal, gunakan opsi edge, broker, mode sensor, dan prosedur yang sama.
- Lokasi dapat kurang akurat di dalam ruangan. Grid adalah pengelompokan sampel, bukan cakupan radio.
- `.env` dan kredensial tidak boleh masuk repository. ID proyek bukan otorisasi broker.
- ZIP revisi tidak otomatis memperbarui GitHub atau mengubah situs yang sudah diterbitkan.
