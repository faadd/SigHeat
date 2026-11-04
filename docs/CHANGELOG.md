# Perubahan SigHeat

## Versi 4.0 - 4 November 2026

- Memindahkan prediksi RTT ke halaman peta; menghapus tab Prediksi ML dan tombol training pengguna.
- Memuat parameter Ridge dan centroid K-Means yang telah dilatih secara offline. Model awal paket berasal dari data sintetis dan ditandai demikian.
- Mengganti kategori dashboard berbasis threshold RTT dengan tiga kelompok beban relatif dari K-Means; field kategori edge lama diabaikan untuk keputusan tampilan.
- Menambahkan kandidat pembaruan otomatis dan pembandingan pada pengukuran baru. Kandidat dipromosikan hanya jika memenuhi margin perbaikan terhadap pembanding; baseline regresi dapat tetap dipakai jika lebih baik.
- Menyimpan model serta riwayat fitur terbatas di browser, dengan ekspor/pemulihan cadangan, pemisahan demo, dan tanpa penyimpanan koordinat GPS atau kredensial broker pada state pembelajaran.
- Memisahkan identitas model dari boot perangkat sambil mempertahankan larangan window RTT lintas boot/gap; classifier koneksi digunakan bersama dalam konteks proyek/runtime/broker/interval yang sama.
- Menyediakan builder untuk mengemas model hasil pengukuran kelompok sebagai bawaan situs. Paket awal belum memuat model lapangan kelompok.
- Menambahkan pengujian engine, persistensi, seed, serta integrasi; hasil eksekusi aktual dicatat di `RELEASE_VALIDATION.md`.
- Memperbarui pembahasan AI, dataset card, alur demo, presentasi, panduan upgrade, dan daftar file commit. Catatan versi sebelumnya di bawah merupakan riwayat, bukan petunjuk UI versi 4.

## Versi 3.0 - 4 November 2026

- Menambahkan regresi Ridge untuk RTT berikutnya, pelatihan lokal, pemisahan kronologis, dan evaluasi terhadap dua baseline.
- Menambahkan menu Prediksi ML dengan data terpisah per perangkat/sesi, demo sintetis, serta ekspor dataset/model/evaluasi.
- Melengkapi kolom identitas sesi pada ekspor CSV asli, sehingga urutan pengamatan dapat diperiksa.
- Menyediakan CLI, 480 baris data sintetis, model contoh, dan 24 tes baru untuk engine serta panel ML.
- Menambahkan pembahasan AI, PDF, panduan percobaan, dataset card, dan bahan presentasi.

## Riwayat versi 2.1: dua opsi edge

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
