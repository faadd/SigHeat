# Menjalankan dan menguji SigHeat 4.0

## Menjalankan dashboard

Ekstrak paket, masuk ke folder yang memuat `server.py`, lalu jalankan:

```bash
python server.py --port 8000
```

Buka `http://localhost:8000/dashboard.html`. Server memakai Python 3.10+ dan pustaka standar. Model berjalan di browser; tidak perlu memasang pustaka ML Python atau API AI berbayar. Node.js 18+ diperlukan untuk CLI dan tes JavaScript.

Tidak ada menu Prediksi ML atau tombol training. Pada halaman peta, ringkasan **Pembelajaran otomatis** memperlihatkan **Prediksi RTT berikutnya**, **Kelompok koneksi**, serta asal/status model untuk perangkat terpilih. Buka **Rincian pembelajaran & cadangan** jika perlu melihat proses model atau mengelola hasil.

## Demo cepat tanpa HP

1. Buka dashboard dan klik **Lihat contoh lokal**.
2. Pilih salah satu perangkat contoh pada peta atau daftar perangkat.
3. Periksa nilai RTT sintetis, kategori beban relatif, dan prediksi berikutnya. Model bawaan sudah tersedia; tidak ada langkah menekan training.
4. Periksa label asal data/model. Semua sampel pada demo ini adalah ilustrasi, bukan pengukuran nyata.
5. Hubungkan broker sesuai README untuk kembali menerima pengukuran nyata.

Demo peta asli berisi sedikit sampel ilustratif. Ia menunjukkan inferensi model awal, bukan cukup data untuk membuktikan adaptasi otomatis. Dataset demo 480 baris dan generator CLI tetap disertakan untuk pengujian yang dapat diulang. Demo tidak dikirim ke broker dan tidak memperbarui model nyata yang tersimpan.

## Demonstrasi memakai dua HP nyata

1. Siapkan HP A, HP B, laptop, jaringan, serta broker mengikuti README. Gunakan ID perangkat berbeda, ID proyek sama, dan alamat broker sama.
2. Buka dashboard melalui origin yang sama dengan sesi sebelumnya agar pembelajaran tersimpan dapat dimuat. Misalnya tetap memakai `http://localhost:8000` pada browser yang sama.
3. Hubungkan dashboard melalui **Atur koneksi**, lalu mulai kedua edge dengan opsi Browser atau Termux sesuai panduan.
4. Pastikan pengamatan kedua perangkat diterima, sensor tersedia bila perangkat mendukung, dan command/ACK asli berfungsi.
5. Pilih perangkat di peta atau tabel. Setelah enam RTT valid pada boot saat ini, periksa prediksi berikutnya. Kategori K-Means menggunakan profil pengamatan yang lengkap.
6. Lanjutkan perekaman. Sistem mengusulkan kandidat model secara otomatis ketika jumlah data cukup. Status dapat berupa model awal, pengumpulan data, pengujian kandidat, kandidat ditolak, atau model adaptif aktif.
7. Buka rincian pembelajaran untuk memeriksa jumlah data, kemajuan kandidat, dan metrik pembanding. Tidak perlu menekan tombol training.
8. Unduh dataset dan cadangan sebelum demonstrasi berakhir. Catat waktu, konfigurasi, dan kondisi percobaan untuk laporan.

Pada interval 5 detik, 120 baris memerlukan kira-kira 10 menit bila berjalan lancar. Pengujian kandidat membutuhkan pengukuran baru setelah model dibuat, sehingga jangan mengharapkan model adaptif langsung diterima begitu hitungan mencapai 120. Timeout, gap, data kurang bervariasi, atau baseline yang lebih baik dapat menunda maupun menolak pembaruan.

Untuk presentasi singkat, gunakan model yang sudah terkumpul pada percobaan nyata sebelumnya dan origin yang sama. Tetap jelaskan apakah model aktif masih bawaan sintetis atau sudah berasal dari pengukuran. Menunjukkan kandidat ditolak juga merupakan demonstrasi pengendalian model yang valid; jangan memaksa promosi hanya agar terlihat “belajar”.

## Apa yang terjadi setelah refresh atau reboot?

| Kejadian | Hasil yang diharapkan |
|---|---|
| Refresh dashboard pada browser/origin sama | Model dan riwayat fitur tersimpan dimuat; telemetri baru masih diperlukan untuk menyatakan perangkat aktif |
| HP memulai boot baru dengan konteks sama | Model dapat digunakan kembali, tetapi enam RTT inferensi tidak menyambungkan boot lama dan baru |
| Mengubah broker, interval, sumber, atau mode accelerometer | Konteks regresi berbeda; model yang tidak cocok tidak dipaksakan |
| Beralih laptop/browser/port/hostname | Penyimpanan origin berbeda; pulihkan cadangan yang sesuai bila diperlukan |
| Browser menolak atau kehabisan ruang penyimpanan | Aplikasi memberi pesan dan tetap berjalan di memori; perubahan mungkin hilang saat halaman ditutup |
| Tab dashboard ditutup | Tidak ada proses belajar terus-menerus setelah halaman berhenti berjalan |

Browser HP dapat menjeda pembacaan sensor ketika tab tersembunyi, sesuai perilaku edge asli. Jeda ini bukan kegagalan algoritma training. Gunakan kondisi yang sama untuk membandingkan dua HP.

## Mengunduh dan memulihkan

Buka **Rincian pembelajaran & cadangan** pada halaman peta.

- **Unduh dataset perangkat (CSV)** menyimpan data perangkat/konteks yang dipilih untuk pemeriksaan dan eksperimen.
- **Unduh cadangan pembelajaran** menyimpan model serta riwayat fitur yang didukung format versi 4.
- **Pulihkan cadangan pembelajaran (JSON)** membaca cadangan tersebut, memvalidasi isi, dan menolak file yang tidak sesuai.
- **Hapus pembelajaran tersimpan** menampilkan konfirmasi. Tindakan **Ya, hapus pembelajaran** menghapus pembelajaran lokal SigHeat; **Batal** mempertahankannya. Unduh cadangan lebih dahulu bila ingin dapat memulihkan.

File JSON model tunggal versi 3 bukan cadangan versi 4. Jangan mengubah `source` dari `demo` menjadi `browser` untuk membuat data sintetis terlihat nyata. Cadangan tidak membawa password broker atau koordinat GPS, tetapi tetap memuat metadata seperti ID proyek/perangkat dan alamat broker yang perlu dipertimbangkan sebelum dibagikan.

## Menyiapkan model kelompok sebelum presentasi

Jika kelompok ingin hasil training sendiri tersedia otomatis pada browser baru, lakukan pengukuran nyata dan tunggu model hasil pengukuran dipromosikan, lalu unduh cadangan. Jalankan:

```bash
node scripts/build-learning-seed.cjs --input sigheat-pembelajaran.json
```

Builder menolak cadangan yang hanya berisi bootstrap sintetis. Commit `assets/learning-seed.js` hasil builder bersama proyek; file itu memuat state pembelajaran yang telah divalidasi, tanpa GPS/password. Model hanya dipakai pada konteks yang cocok, dan cache lokal valid tetap lebih diprioritaskan. Alur lengkap serta cara menguji seed ada pada `docs/UPGRADE_V4.md`. Tidak ada langkah training/import yang harus dilakukan penonton saat demo.

## Membuat ulang model awal

Jalankan dari akar proyek:

```bash
node scripts/build-default-model.cjs
node scripts/build-cluster-default.cjs
```

Perintah ini melatih model bawaan secara offline dari data sintetis deterministik dan menulis ulang artefak model. Dashboard kemudian memuat parameter hasil training; dashboard tidak menjalankan perintah build saat dibuka.

Eksperimen regresi melalui CLI tetap dapat dijalankan:

```bash
node scripts/generate-ml-demo.cjs
node scripts/train-ml.cjs --input data/demo-synthetic.csv --output models/demo --allow-synthetic
```

Tanpa opsi tambahan, CLI menerima satu aliran/sesi. Tambahkan `--context` untuk data beberapa boot yang berada pada proyek, perangkat, sumber, broker, interval, dan mode sensor yang sama; window input tetap tidak melintasi boot. Contoh:

```bash
node scripts/train-ml.cjs --input data-pengukuran.csv --output models/percobaan --context
```

`data-pengukuran.csv` pada contoh harus diganti dengan file ekspor kelompok yang benar-benar tersedia. Output model/report CLI tidak otomatis menjadi cadangan dashboard; gunakan ekspor cadangan dashboard untuk builder seed.

## Pengujian otomatis

```bash
node --test tests/*.cjs
python -m unittest discover -s tests -p 'test_*.py' -v
```

Dependensi jalur Python/Termux dapat dipasang dengan:

```bash
python -m pip install -r requirements.txt
```

Lihat **RELEASE_VALIDATION.md** untuk hasil tes paket yang benar-benar dijalankan. Tes memakai data deterministik, DOM tiruan, dan perangkat/broker tiruan bila sesuai. Kelulusan tes bukan bukti bahwa sensor fisik, browser HP, broker kelompok, atau prediksi jaringan nyata telah terverifikasi.

## Protokol percobaan lapangan

| Tahap | Tindakan | Bukti yang dicatat |
|---|---|---|
| Persiapan | Catat dua HP, OS, runtime, broker/tunnel, interval dan mode sensor | Tabel konfigurasi eksperimen |
| Kondisi awal | Kedua HP berada di tempat yang sama, stabil, dan tetap aktif | RTT, jitter, keberhasilan, missing sensor |
| Variasi | Ubah satu kondisi, misalnya titik pengamatan atau aktivitas berjalan | Waktu perubahan dan kondisi sebenarnya |
| Penyesuaian | Biarkan data baru membentuk kandidat otomatis | Model awal, cut-off training, jumlah penilaian baru |
| Keputusan | Tunggu syarat evaluasi dan catat diterima/ditolak | MAE ketiga pembanding atau jarak kuantisasi |
| Pengujian akhir | Setelah pilihan model dibekukan, rekam periode baru | Hasil pada data yang tidak dipakai memilih model |
| Pengulangan | Ulangi pada waktu/sesi lain dengan konfigurasi dicatat | Kestabilan hasil dan kegagalan generalisasi |

Simpan hasil yang kalah terhadap baseline. Untuk menguji kontribusi sensor, lakukan ablation pada pemisahan waktu yang sama; keberadaan fitur sensor saja tidak membuktikan bahwa sensor meningkatkan prediksi. Untuk menilai makna kategori K-Means, tambahkan observasi pengalaman penggunaan yang independen. Inertia rendah tidak sama dengan kualitas layanan baik.

## Lembar hasil kelompok

| Percobaan | Perangkat/konteks | Asal model aktif | Sampel/target valid | MAE Ridge | MAE baseline | Status kandidat | Catatan kondisi |
|---|---|---|---|---|---|---|---|
| 1 | Belum diisi | Belum diisi | Belum diisi | Belum diisi | Belum diisi | Belum diisi | Belum diisi |
| 2 | Belum diisi | Belum diisi | Belum diisi | Belum diisi | Belum diisi | Belum diisi | Belum diisi |

Tanda “belum diisi” bukan nol. Jangan menyalin hasil sintetis sebagai hasil pengukuran lapangan. Dokumentasikan bantuan pengembangan yang digunakan sesuai aturan mata kuliah, lalu pastikan seluruh anggota dapat menjelaskan dan menjalankan kode yang dikumpulkan.
