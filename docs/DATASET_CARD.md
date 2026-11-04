# Dataset card: SigHeat 4.0

## Asal data dan tujuan

Arsip awal kelompok tidak memuat histori RTT lapangan untuk training. Paket memuat data sintetis dan model awal yang dilatih dari data tersebut agar sistem dapat dijalankan tanpa training manual di layar. Data sintetis hanya menguji alur, bukan meniru seluruh kondisi Wi-Fi, radio, broker, atau perangkat pengguna.

Model Ridge bawaan versi 4 dilatih dari 960 telemetri sintetis dengan seed 240601 dan interval nominal 5 detik. Dataset demo versi 3 yang tetap disertakan berisi 480 baris; dataset itu berbeda dari jumlah baris build model bawaan versi 4. Generator K-Means menghasilkan 480 profil RTT, variasi dan keberhasilan dengan seed 240601 tanpa label kategori. Nilai kelompok buatan pada generator bukan threshold inferensi; centroid hasil fit yang menentukan batas klasifikasi.

Data nyata harus berasal dari telemetri HP kelompok. Nilai `source=browser` atau `termux` adalah klaim runtime di payload, bukan bukti autentikasi identitas perangkat. Broker publik dan topic unik tidak dengan sendirinya mencegah pihak lain mengirim payload yang formatnya valid.

## Unit, target, dan fitur

Satu baris adalah satu telemetri dari satu perangkat pada satu boot. RTT adalah waktu pesan aplikasi HP-broker-HP dalam ms.

| Komponen | Masukan/keluaran |
|---|---|
| Regresi Ridge | 16 fitur dari enam RTT terakhir, statistik koneksi, gerakan, dan indikator kehilangan |
| Target regresi | RTT mentah pada telemetri berikutnya yang langsung berurutan dan berhasil |
| K-Means | RTT terakhir, jitter, dan proporsi gagal dalam transformasi tetap |
| Keluaran K-Means | Cluster relatif rendah/sedang/tinggi, tanpa label kualitas manual |

Tidak ada fitur GPS, nama pemilik, password, atau token broker pada model pembelajaran. Data geolokasi aplikasi utama tetap opsional dan dipakai untuk peta; ekspor CSV utama dapat memuat koordinat sehingga perlu diperiksa sebelum dibagikan.

## Kolom penting

| Kolom | Tipe/satuan | Fungsi |
|---|---|---|
| `project_id`, `device_id` | String ID | Identitas konteks |
| `boot_id`, `sequence` | String dan integer positif | Menjaga urutan dalam sesi dan mencegah window lintas reboot |
| `source` | browser/termux/demo | Memisahkan runtime dan data sintetis |
| `broker_endpoint` | URL WSS tanpa kredensial | Konteks rute probe |
| `sent_at_ms` | Epoch ms | Urutan waktu dan gap |
| `interval_s` | Detik | Konteks dan interval nominal |
| `latency_ms`, `probe_ok` | ms atau null; boolean | RTT aktual dan keberhasilan probe terakhir |
| `latency_std_ms` | ms atau null | Jitter/konteks variasi |
| `success_pct` | 0-100 persen | Statistik keberhasilan probe |
| `accel_rms`, `gyro_rms_rad_s` | m/s²; rad/s; atau null | Konteks gerakan |
| `accel_mode` | linear/gravity_removed/unavailable | Metode pengukuran sensor |
| Indikator ketersediaan sensor | Boolean | Validasi nilai hilang |

Payload lengkap, CSV, dan bentuk penyimpanan ringkas memiliki representasi berbeda. Bentuk cadangan harus diproses melalui validator format versi 4; bukan melalui perubahan manual array internal.

## Konteks dan pemisahan

Regresi tersimpan per proyek, perangkat, runtime, broker, interval, dan mode accelerometer. Boot tidak lagi menjadi identitas model, namun tetap melekat pada setiap sampel. Model dapat dipakai lintas boot yang cocok tanpa menyambungkan jendela lag antara boot lama dan baru.

K-Means dipakai bersama untuk proyek, runtime, broker, dan interval yang sama. Dengan begitu dua perangkat pada konteks yang sama menggunakan classifier yang sama. Kategori dari model/konteks berbeda bersifat relatif terhadap model masing-masing; jangan membandingkannya sebagai standar mutu universal.

Data demo menggunakan jalur memori terpisah. Ia tidak masuk ke konteks pembelajaran nyata, cadangan model nyata, atau bukti evaluasi jaringan pengguna.

## Penyaringan dan nilai hilang

- Tolak nilai bukan angka, NaN, infinite, rentang di luar protokol, URL broker berkredensial, metadata tidak sesuai, duplikat, dan urutan mundur.
- Timeout memiliki RTT `null`, bukan nol atau angka timeout buatan.
- Regresi memerlukan enam RTT dan target berikutnya yang valid. Gap sequence, pergantian boot, dan selang waktu di luar batas membatalkan pasangan terkait.
- Sensor/jitter yang hilang memakai pengisi nol bersama indikator kehilangan pada fitur Ridge. RTT lag tidak diimputasi.
- K-Means memerlukan RTT berhasil, jitter dan success_pct lengkap. Timeout atau jitter hilang tetap unknown. Fit memerlukan data cukup bervariasi dan cluster yang tidak kolaps.

Penyaringan keberhasilan membuat kondisi dengan banyak timeout kurang terwakili dalam evaluasi regresi dan clustering. Model tidak memprediksi peluang outage. Laporkan jumlah pengamatan tidak terpakai dan kegagalan probe di samping galat prediksi.

## Training, evaluasi, dan pencegahan kebocoran

Kandidat Ridge menggunakan pemisahan waktu internal 60/20/20. Scaler training tidak memakai masa depan. Enam baris input eksplisit serta target tidak melintasi batas bagian atau boot. Statistik edge yang sudah diringkas boleh merangkum pengamatan masa lalu sebelum batas bagian, sehingga tidak tepat menyebut seluruh asal data mentah antarbagian sepenuhnya terpisah.

Promosi otomatis kemudian dinilai memakai pengukuran baru setelah kandidat dibekukan. Kandidat, model aktif, dan baseline dibandingkan pada target yang sama. Nilai hasil promosi bukan test akhir independen; keputusan promosi menggunakan nilai itu. Rekam periode baru untuk evaluasi akhir laporan.

Kandidat K-Means dan model aktif memakai transformasi fitur yang sama ketika dibandingkan. Ukurannya adalah jarak kuadrat ke centroid terdekat, bukan accuracy%. Label eksternal dibutuhkan jika ingin menilai kategori terhadap pengalaman pengguna yang sebenarnya.

## Retensi dan pemulihan

Pembelajaran disimpan dalam storage browser yang sama dan dibatasi jumlah konteks serta baris terbaru. Batas implementasi adalah 12 konteks regresi dan 12 konteks clustering, masing-masing berisi paling banyak 1.200 baris terbaru. Konteks yang paling dahulu dibuat dapat tersisih ketika batas tercapai; data lama juga dapat tergeser. Tidak ada janji semua pengukuran sepanjang masa disimpan. Ekspor dataset dan cadangan secara berkala bila eksperimen perlu direproduksi.

Refresh mempertahankan data/model yang berhasil disimpan, tetapi tidak membuat data lama menjadi telemetri live baru. Akumulasi penilaian kandidat dimulai ulang setelah restore. Browser lain atau origin lain mempunyai penyimpanan berbeda. Kuota, mode privat, atau penghapusan data situs dapat menghilangkan hasil yang belum dicadangkan.

Backup berisi metadata seperti alamat broker dan ID perangkat walaupun tanpa password/GPS. Periksa sebelum berbagi. Menghapus pembelajaran lokal tidak menghapus file unduhan yang telah dibuat pengguna.

## Model kelompok yang dikemas

`assets/learning-seed.js` awalnya kosong. Setelah pengukuran nyata dan promosi model otomatis, kelompok dapat mengemas cadangan dengan `scripts/build-learning-seed.cjs`. Builder memerlukan sedikitnya satu model aktif berprovenance pengukuran, memvalidasi seluruh cadangan, dan hanya menyalin field state yang dikenal. Metadata provenance adalah catatan asal, bukan bukti autentikasi data.

Seed merupakan snapshot pembelajaran terbatas, bukan sinkronisasi data antarpengguna. Model tetap terikat konteks; cache lokal yang valid lebih diprioritaskan. Periksa metadata perangkat/proyek dan alamat broker sebelum meng-commit seed. Jangan mengemas data sintetis yang source-nya diubah menjadi pengukuran nyata.

## Batas penggunaan

Adaptasi menggunakan pelatihan ulang berkala dari buffer terbaru, bukan perubahan bobot per sampel atau penyimpanan seluruh data sepanjang masa. Model awal sintetis bersifat eksperimental pada jaringan nyata. Kategori relatif bukan batas SLA, kekuatan sinyal radio, diagnosis penyebab gangguan, atau kepastian dead zone. Adaptasi tidak selalu meningkatkan hasil. Data bias, perubahan rute broker, HP berbeda, tab tertunda, dan perubahan pola penggunaan dapat membuat model meleset.

Simpan konfigurasi, dataset, versi kode, model, serta periode penilaian bersama. Jangan menamai hasil sintetis sebagai hasil kampus atau mengubah source untuk melewati pemisahan data.
