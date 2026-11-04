# Dataset card: telemetri SigHeat ML

## Asal dan tujuan

ZIP sumber tidak menyertakan riwayat pengukuran nyata untuk melatih model jaringan kelompok. Data contoh yang disertakan adalah **sintetis**, dibuat oleh `SigHeatML.generateDemoRows()` melalui `scripts/generate-ml-demo.cjs`. Dataset contoh default memiliki 480 baris, seed `240601`, interval 5 detik, satu perangkat `hp-demo`, dan waktu awal tetap 1 Januari 2026 UTC. Timestamp tersebut merupakan waktu simulasi, bukan tanggal pengambilan data.

Tujuannya adalah memeriksa pelatihan, evaluasi dan tampilan secara berulang. Generator menggunakan proses autoregresif dan variasi periodik yang sengaja dapat dipelajari, dengan noise berseed. Ia bukan simulator fisika radio, model beban broker, atau representasi distribusi jaringan kampus. Dataset demo default tidak mencakup timeout; kasus gagal diuji melalui fixture pengujian tersendiri.

Dataset nyata harus berasal dari telemetri HP yang dikumpulkan kelompok. Label `source=browser` atau `termux` menunjukkan jalur runtime yang diklaim payload, bukan bukti autentikasi identitas perangkat. Pada broker publik, data dari topic yang sama tidak otomatis terpercaya hanya karena formatnya valid.

## Unit pengamatan dan target

Satu baris adalah satu telemetri probe dari satu perangkat/sesi. Target regresi adalah `latency_ms` pada baris berikutnya yang langsung berurutan, dalam ms, bila probe berhasil. Jendela enam RTT dan target harus valid serta berada dalam bagian waktu yang sama.

RTT adalah latency pesan aplikasi melalui broker MQTT. Nilai tidak boleh dipakai sebagai dBm, throughput, atau kepastian cakupan lokasi.

## Kolom penting

| Kolom | Tipe/satuan | Penggunaan |
|---|---|---|
| `mode` | String | `contoh-lokal` untuk demo atau `pengukuran-perangkat` untuk data nyata |
| `project_id` | String ID | Memisahkan proyek |
| `device_id`, `boot_id` | String ID | Memisahkan perangkat dan sesi boot |
| `source` | `browser`, `termux`, `demo` | Memisahkan sumber dan asal sintetis |
| `broker_endpoint` | URL `wss://` | Konteks jalur pengukuran, tanpa kredensial |
| `schema_version` | Integer | Versi telemetri, nilai 2 |
| `latency_type` | String | `mqtt_app_rtt` |
| `sequence` | Integer positif | Urutan sampel dalam sesi |
| `sent_at_ms` | Epoch ms | Urutan waktu dan pemeriksaan jarak sampel |
| `interval_s` | Detik, 2–60 | Target interval dan konteks model |
| `latency_ms` | ms atau null | RTT terakhir; target berikutnya dan fitur lag |
| `probe_ok` | Boolean | Konsisten dengan tersedia/tidaknya RTT |
| `latency_std_ms` | ms atau null | Konteks variasi RTT pada baris terbaru |
| `success_pct` | Persen, 0–100 | Konteks keberhasilan probe |
| `accel_rms` | m/s² atau null | Konteks RMS percepatan terbaru |
| `gyro_rms_rad_s` | rad/s atau null | Konteks RMS kecepatan putar terbaru |
| `accel_mode` | `linear`, `gravity_removed`, `unavailable` | Memisahkan metode sensor |
| `accel_available`, `gyro_available` | Boolean | Konsistensi ketersediaan sensor |

Kolom tambahan seperti rerata latency, integrasi rotasi, jumlah sampel, waktu penerimaan, dan koordinat tetap berguna untuk audit IoT tetapi tidak semuanya menjadi fitur ML. Dataset unduhan panel ML tidak memerlukan koordinat GPS. Ekspor CSV utama dashboard dapat memuat lokasi; periksa sebelum membagikannya.

## Validasi dan penanganan nilai hilang

- Baris harus memiliki konteks tunggal serta timestamp dan sequence yang meningkat. Engine menolak campuran konteks, duplikat, dan urutan mundur; ia tidak diam-diam mengurutkan ulang.
- `latency_ms=null` harus berpasangan dengan `probe_ok=false`. RTT gagal tidak diubah menjadi nol atau angka timeout.
- Enam input dan satu target harus semuanya memiliki RTT valid. Sequence yang melompat atau selisih waktu di luar 0,5–2,5 kali interval membatalkan jendela terkait.
- Fitur sensor atau jitter yang hilang menggunakan pengisi nol dan penanda kehilangan bernilai satu. Nilai tersebut bukan pengamatan fisik nol.
- Nilai NaN, infinite, angka di luar rentang, serta URL broker berkredensial ditolak. Parser CSV mengonversi nilai numerik dan boolean ke tipe yang diperlukan, lalu engine memvalidasinya.

## Pemisahan dan reproduksibilitas

Data dibagi menurut urutan baris 60/20/20. Enam baris jendela dan satu target eksplisit tidak melintasi batas bagian. Ringkasan statistik yang sudah dihitung edge dapat mencakup probe terdahulu sebelum batas bagian, tetapi tidak boleh mencakup masa depan. Pada demo 480 baris tanpa celah, terdapat 288/96/96 baris mentah dan 282/90/90 pasangan training/validation/test. Normalisasi dihitung dari training, alpha dan prediktor dipilih dari validation, dan test hanya mengevaluasi.

Model menyimpan urutan fitur, pusat/skala normalisasi, koefisien, intersep, alpha, identitas konteks, horizon nominal, asal data, batas waktu training/evaluasi, serta ringkasan metrik. Simpan CSV, model dan evaluasi bersama sehingga hasil dapat ditelusuri. Angka demo yang dihasilkan ulang harus sama selama generator, seed, data, dan kode engine tidak berubah.

## Penyimpanan dan privasi

Data/model dashboard berada dalam memori tab dan hilang saat dimuat ulang atau ditutup. Buffer ML dibatasi pada 3.000 baris terbaru per konteks. Unduh berkas sebelum reset, beralih ke demo, atau menutup tab. File yang diunduh menjadi tanggung jawab penyimpanan kelompok.

Jangan masukkan password broker atau token tunnel ke CSV/model. Model menyimpan alamat broker sebagai konteks, sehingga periksa kebutuhan merahasiakan alamat itu sebelum membagikan model. Hindari lokasi pribadi dalam ekspor dashboard umum. Proyek ID pada broker publik memisahkan topic tetapi bukan mekanisme autentikasi.

## Batas penggunaan

Model hanya memperkirakan RTT pengukuran selanjutnya pada konteks yang cocok, termasuk sesi boot yang sama. Ia tidak mengidentifikasi penyebab lambatnya jaringan, memprediksi timeout, membuktikan hubungan sebab-akibat gerakan dan jaringan, atau menjamin generalisasi lintas HP/sesi/broker. Penyaringan jendela valid membuat periode dengan banyak timeout kurang terwakili pada evaluasi. Tidak ada hasil demo yang boleh dilaporkan sebagai hasil pengukuran kampus. Gunakan tabel test dan pengulangan protokol pada sesi baru untuk menilai konsistensi manfaat nyata.
