# Menjalankan, mendemokan, dan menguji SigHeat ML

## Mulai dari laptop

Ekstrak ZIP, masuk ke folder proyek yang memuat `server.py`, lalu jalankan:

```bash
python server.py --port 8000
```

Buka `http://localhost:8000/dashboard.html`. Server ini hanya membutuhkan Python 3.10+ dan pustaka standar. Model dilatih di browser; Node.js diperlukan hanya untuk CLI dan tes JavaScript. Jalur dua HP tetap mengikuti [README](../README.md), [browser edge](BROWSER_EDGE.md), atau [Android/Termux](ANDROID.md).

## Demo tanpa HP atau broker

1. Buka menu **Prediksi ML** pada sidebar.
2. Klik **Coba data sintetis**. Aplikasi memutus koneksi MQTT dan membersihkan data dashboard sebelumnya, kemudian menggunakan 480 telemetri buatan. Unduh data nyata yang perlu disimpan sebelum beralih.
3. Periksa label sintetis dan perangkat contoh. Data ini dibuat dengan seed tetap sehingga dapat direproduksi.
4. Klik **Latih & evaluasi**. Dashboard membagi data menurut waktu, melatih beberapa kandidat Ridge, memilih melalui validation, lalu menampilkan hasil test.
5. Baca tabel perbandingan Ridge, persistence, dan rata-rata bergerak. Perhatikan satuan ms dan metode yang dipilih.
6. Periksa RTT terakhir dan prediksi berikutnya. Angka prediksi bukan hasil pengukuran nyata.
7. Unduh **dataset perangkat (CSV)**, **model (JSON)**, dan **evaluasi (JSON)** bila diperlukan untuk pembahasan.
8. Klik **Kembali ke pengukuran**, lalu sambungkan kembali broker melalui **Atur koneksi** untuk pengukuran nyata.

Demo sengaja memiliki pola yang mudah dipelajari. Ia memeriksa alur aplikasi, bukan meniru seluruh perilaku Wi-Fi atau membuktikan model akan mengungguli baseline pada jaringan kampus. Demo peta asli “Lihat contoh lokal” hanya berisi sedikit pengamatan ilustratif dan berbeda dari dataset training ML ini.

## Melatih memakai pengukuran kedua HP

1. Siapkan kedua HP, laptop, jaringan dan broker mengikuti README. Pastikan ID perangkat berbeda dan ID proyek serta alamat broker sama.
2. Gunakan opsi sumber yang konsisten untuk percobaan awal, misalnya keduanya Browser atau keduanya Termux. Beri izin sensor. Lokasi opsional untuk peta dan tidak dipakai sebagai fitur ML.
3. Mulai telemetri dan periksa bahwa kedua perangkat muncul. Pastikan bacaan sensor dan RTT bergerak sesuai aktivitas, serta command/ACK asli bekerja.
4. Tetapkan interval, misalnya 5 detik, sebelum perekaman. Selama perekaman awal, hindari mengubah interval, memulai ulang sesi, atau berulang kali menekan “Ukur sekarang”.
5. Pada **Prediksi ML**, pilih **Perangkat untuk model**. Panel memakai kelompok data perangkat/sesi saat ini; HP A dan HP B dilatih terpisah.
6. Kumpulkan minimal 120 baris dalam satu kelompok. Data dengan timeout atau jeda dapat membuat pasangan valid terlalu sedikit walaupun jumlah baris sudah cukup. Gunakan 300–1.000 baris bila waktu memungkinkan.
7. Klik **Latih & evaluasi**. Simpan jumlah baris, jumlah pasangan valid, jumlah jendela yang dikeluarkan, alpha, metrik, dan metode terpilih.
8. Lanjutkan pengukuran untuk melihat prediksi pada data yang datang sesudah pelatihan. Hasil tabel evaluasi tetap berasal dari snapshot saat tombol ditekan; tabel tidak otomatis berubah menjadi evaluasi data baru.
9. Klik **Latih ulang & evaluasi** hanya jika ingin membuat model dan pembagian waktu baru. Catat bahwa ini eksperimen baru, bukan perbaikan retroaktif hasil test lama.
10. Ulangi untuk perangkat lainnya, dan ekspor hasil masing-masing.

Data dan model berada dalam memori tab. Memuat ulang atau menutup halaman menghapusnya. Buffer ML menyimpan paling banyak 3.000 baris terbaru per kelompok; ekspor berkala sebelum data lama tergeser. Ekspor CSV utama dashboard tetap memiliki batas riwayat peta/sesi sendiri; gunakan **Unduh dataset perangkat (CSV)** untuk alur training ML satu kelompok tanpa koordinat GPS.

Prediksi live berhenti ditampilkan ketika dashboard terputus atau data dianggap tidak aktif. Setelah timeout, perlu enam probe terakhir yang valid dan berurutan agar jendela inferensi kembali tersedia. Pergantian perangkat, sumber, sesi, broker, interval, atau mode accelerometer membutuhkan model yang cocok.

## Reproduksi melalui command line

Jalankan dari folder proyek dengan Node.js yang mendukung `node --test` (disarankan Node.js 20+):

```bash
node scripts/generate-ml-demo.cjs
node scripts/train-ml.cjs --input data/demo-synthetic.csv --output models/demo --allow-synthetic
```

Opsi `--allow-synthetic` wajib untuk data contoh agar asal data tidak terlewat. Untuk CSV pengukuran nyata yang diunduh dari panel ML:

```bash
node scripts/train-ml.cjs --input data/pengukuran-hp-a.csv --output models/hp-a
```

CLI menerima CSV, JSON berupa array baris, atau objek JSON dengan properti `rows`, dengan satu aliran per berkas. Data campuran, nilai numerik tidak valid, duplikat, atau urutan mundur ditolak dengan pesan kesalahan. Hasilnya berupa `model.json` dan `report.json` di direktori keluaran. File unduhan model berfungsi sebagai hasil yang dapat diperiksa/dipakai melalui API JavaScript; dashboard versi ini belum menyediakan tombol impor model.

## Tes otomatis

```bash
node --test tests/*.cjs
python -m unittest discover -s tests -p 'test_*.py' -v
```

Sebagian tes Python memerlukan dependensi jalur Termux, yang dipasang dengan:

```bash
python -m pip install -r requirements.txt
```

Tes memakai data deterministik dan perangkat/broker tiruan ketika sesuai. Kelulusan tes tidak membuktikan sensor fisik, broker kelompok, izin browser HP, dan akurasi prediksi lapangan.

Hasil pemeriksaan paket pada **4 November 2026**:

| Pemeriksaan | Hasil dan batas bukti |
|---|---|
| `npm test` | 57 tes lulus, 0 gagal, mencakup ML serta regresi fungsi core, protokol, dashboard, dan edge |
| Tes Python | 26 tes dijalankan: 25 lulus, 1 dilewati karena dependensi Paho tidak tersedia untuk pemeriksaan konteks TLS Paho nyata |
| Verifikasi solver independen | Hasil dibandingkan dengan NumPy: selisih koefisien maksimum sekitar 1,51 × 10⁻¹⁰ dan selisih prediksi sekitar 1,72 × 10⁻¹² ms pada data sintetis |
| Render browser desktop/HP | Belum dapat diverifikasi pada lingkungan pengerjaan ini |
| Dua HP fisik dan broker kelompok | Belum diuji; wajib dilakukan kelompok |

Model contoh sintetis menghasilkan test MAE Ridge sekitar **2,546 ms**. Angka ini hanya hasil dari proses buatan yang sengaja mudah dipelajari, bukan akurasi jaringan nyata. Lihat `models/demo/report.json` untuk seluruh nilai dan batas pembagian.

Kasus yang perlu dicakup: urutan input-target, pemisahan waktu, perubahan data test tidak mengubah training, perbandingan baseline, data konstan, sensor hilang, timeout, celah sequence/waktu, campuran konteks, model rusak, perbedaan demo/live, dan mempertahankan fungsi MQTT asli.

## Protokol eksperimen lapangan

Gunakan eksperimen yang memungkinkan kondisi dibandingkan. Jangan mengubah banyak faktor sekaligus.

| Tahap | Tindakan | Catatan yang disimpan |
|---|---|---|
| Persiapan | Catat model HP, OS, browser/Termux, broker dan jalurnya, interval, mode sensor | Identitas eksperimen dan konfigurasi |
| Kondisi awal | Letakkan dua HP di tempat yang sama dan stabil beberapa menit | RTT, keberhasilan probe, sensor, jumlah timeout |
| Variasi | Uji satu perubahan, misalnya pindah titik atau aktivitas berjalan | Waktu perubahan dan kondisi yang benar-benar dilakukan |
| Pelatihan | Latih per perangkat/konteks setelah data cukup | CSV, model, report, jumlah contoh yang tersaring |
| Evaluasi | Bandingkan MAE/RMSE ketiga metode di test | Hasil menang/kalah, bukan hanya angka terbaik |
| Pengulangan | Rekam sesi lain pada kondisi yang dicatat | Apakah kesimpulan stabil antarsesi |
| Pelaporan | Pisahkan bukti sintetis, otomatis, dan perangkat nyata | Video, tabel hasil, keterbatasan |

Model versi ini terikat pada `boot_id`, sehingga model sesi lama tidak otomatis digunakan untuk sesi baru di dashboard. Pengulangan antarsesi berarti mengulang protokol pelatihan/evaluasi untuk menilai konsistensi hasil, bukan mengklaim model lama telah diuji lintas sesi. Evaluasi generalisasi model yang sama lintas sesi merupakan pengembangan berikutnya yang memerlukan desain pemisahan tersendiri.

Untuk menilai kontribusi sensor secara khusus, rancang eksperimen ablation yang membandingkan konfigurasi fitur pada pemisahan waktu yang sama. Versi ini belum menampilkan ablation otomatis; jangan menyatakan sensor meningkatkan akurasi hanya karena sensor disertakan sebagai fitur.

## Lembar hasil kelompok

Isi tabel berikut setelah percobaan nyata. Tanda “belum diisi” bukan nilai nol.

| Item | HP A | HP B |
|---|---|---|
| Tanggal, waktu, lokasi umum | Belum diisi | Belum diisi |
| Perangkat dan runtime | Belum diisi | Belum diisi |
| Broker/jalur dan interval | Belum diisi | Belum diisi |
| Jumlah baris dan pasangan train/validation/test | Belum diisi | Belum diisi |
| Jendela yang dikeluarkan | Belum diisi | Belum diisi |
| Alpha dan prediktor terpilih | Belum diisi | Belum diisi |
| Test MAE/RMSE Ridge (ms) | Belum diisi | Belum diisi |
| Test MAE/RMSE persistence (ms) | Belum diisi | Belum diisi |
| Test MAE/RMSE rerata bergerak (ms) | Belum diisi | Belum diisi |
| Temuan, kegagalan, dan batasan | Belum diisi | Belum diisi |

Jika baseline menang, itu tetap hasil yang sah. Jelaskan apakah data hampir konstan, sangat acak, terlalu sedikit, atau kondisi test berubah; gunakan data untuk mendukung dugaan tersebut.
