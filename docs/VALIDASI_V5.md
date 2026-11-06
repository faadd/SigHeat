# Validasi SigHeat v5.0.0

Tanggal pemeriksaan: **6 November 2026**. Sumber: `SigHeat-main (2).zip`, versi `package.json` 4.1.0. Dua berkas instruksi Markdown yang dilampirkan identik; seluruh instruksi dibaca. ZIP sumber tidak diubah.

## Hasil aktual

| Pemeriksaan | Hasil |
|---|---|
| Baseline JavaScript sebelum perubahan | 120 lulus |
| Baseline Python sebelum perubahan | 25 lulus, 1 dilewati karena dependensi Paho belum terpasang |
| `npm test` setelah implementasi | **167 lulus, 0 gagal, 0 dilewati** |
| Python dengan `requirements.txt` terpasang | **30 lulus, 0 gagal, 0 dilewati** |
| `npm run build:public` | Berhasil menghasilkan `public-dist` dengan allowlist aset publik |
| Pemeriksaan sintaks server/CLI JavaScript dan skrip shell Termux | Lulus |
| Integrasi MQTT lokal → SQLite → training → API → dua klien | Lulus menggunakan broker Aedes lokal dan fixture deterministik |
| Backup SQLite saat pusat aktif, restart, deduplikasi setelah restart, dan restore | Lulus |
| Dashboard DOM, empat grafik SVG, polling 60 detik, pergantian konfigurasi, kontrol lokal nonaktif | Lulus menggunakan jsdom |
| Publikasi GitHub, konflik, retry, dispatch Pages, pemeriksaan artefak | Lulus menggunakan respons tiruan; **bukan publikasi akun GitHub nyata** |

Runtime pengujian Node.js: **24.22.1**. Dependensi npm terkunci dalam `package-lock.json`. Python diuji setelah memasang `paho-mqtt==2.1.0` dan `python-dotenv==1.1.1` dari `requirements.txt` pada lingkungan uji terpisah.

## Perilaku yang diperiksa

- Data beberapa perangkat dipisahkan sesuai konteks; duplikat, identitas salah, demo, payload rusak, urutan mundur, dan boot lama ditangani.
- Prediksi tersimpan sebelum target datang. Timeout, jeda, reboot, dan target terlambat tidak diubah menjadi RTT nol atau bukti forward baru.
- Kandidat dibekukan, dinilai pada target yang sama dengan pembanding, dan baru dipromosikan sesuai aturan ketat serta margin 5%. Acuan nol dan batas tepat 5% diuji.
- Blok MAE berisi 24 target valid tanpa tumpang tindih. Nilainya dapat dihitung ulang dari pasangan prediksi/aktual. Riwayat lama serta model awal beku tidak berubah setelah promosi/rollback.
- Baseline dapat dipilih tanpa menyebutnya Ridge. K-Means memakai jarak kuadrat pada transformasi fitur tetap; hasilnya bukan akurasi klasifikasi berlabel.
- Database menyimpan arsip di luar buffer training. Satu penulis dilindungi lock, termasuk kasus PID digunakan ulang setelah proses/container mati.
- Kandidat dan kemajuan evaluasi bertahan setelah restart. Backup konsisten tidak memerlukan penghentian pusat; restore/rollback menolak ketika penulis masih aktif.
- Dua klien membaca paket sama; parameter, schema, konteks dan checksum rusak ditolak. Cache valid tetap dipakai pada kegagalan pembaruan. Dashboard baru memakai mode pusat secara default.
- Pergantian URL pusat mengabaikan respons lama yang masih berjalan. Browser tidak menjalankan training nyata pada mode pusat, termasuk ketika modul pusat gagal dimuat.
- API menolak akses tanpa kunci ketika dikonfigurasi, origin yang tidak diizinkan, DNS rebinding localhost, serta akses ke konfigurasi/database/source privat.
- Artefak publik hanya memuat parameter/metadata yang diizinkan. Dataset, koordinat GPS, token dan cadangan browser tidak ikut dalam build Pages.
- Antrean publikasi menggabungkan perubahan, tidak membuat commit duplikat tanpa perubahan, menangani konflik tanpa force, membatasi retry, dan membedakan pusat aktif, commit, deployment, serta sinkronisasi dashboard.
- Grafik berada di panel rincian yang sudah ada. Nilai kosong tampil sebagai celah; kandidat buruk tetap terlihat. Ada filter konteks/waktu/model/status dan ekspor CSV/JSON/SVG.
- Tampilan riwayat dibatasi hingga 2.000 catatan per jenis, setelah filter server diterapkan, dengan penanda pemotongan. Ekspor arsip lengkap tetap tersedia; data database tidak dibuang oleh batas tampilan.
- Ekspor CSV mengambil seluruh log sesuai konteks dan menyertakan prediksi yang dirujuk blok/kandidat. Baris tambahan di luar filter model/waktu diberi `dependency_only`, agar target pembanding tetap dapat dihitung ulang ketika blok memuat pergantian versi atau tampilan dibatasi.
- Peta, heatmap, kategori ML, protokol browser/Termux, perintah kontrol, dan validasi input lama tetap melewati tes regresi.
- Browser melakukan jeda jujur saat tersembunyi, mencoba menyambung kembali, dan memakai boot baru setelah jeda. Termux menangani putus koneksi tanpa mengirim ulang telemetri lama sebagai pengukuran baru.

## Jenis data pengujian

Fixture deterministik dalam `tests/` digunakan untuk menguji program. Sebagian fixture memakai struktur payload `source: browser` untuk menguji jalur penerimaan data nyata; **fixture ini tetap data buatan untuk tes, bukan hasil pengukuran lapangan**. Fixture diproses di database sementara, bukan database pengguna atau artefak rilis.

Paket yang diserahkan berisi model bootstrap **sintetis**, tanpa model terlatih dari HP kelompok. Model hasil tes tidak diterbitkan sebagai hasil belajar kelompok. Grafik awal kosong sampai pusat menerima dan mencatat pengukuran sendiri. JSON evaluasi lama pada percakapan tidak digunakan untuk merekonstruksi kurva live yang tidak pernah direkam.

## Batas verifikasi

- Belum menguji tiga HP fisik pengguna, sensor/perizinan tiap merek, penghematan baterai Android, atau ketahanan layanan pada perangkat mereka.
- Belum mengirim commit, menjalankan workflow pada repository pengguna, atau mengonfirmasi deployment Pages nyata. Pengguna perlu mengatur server, origin, token, dan Pages sesuai panduan.
- Pengujian DOM/SVG berhasil. Pemeriksaan tampilan piksel di Chromium belum dilakukan: binary browser uji tidak tersedia dan unduhan browser gagal. Uji tata letak pada laptop/HP tetap diperlukan.
- Docker/systemd/Caddy disertakan sebagai konfigurasi, tetapi belum dideploy ke mesin pengguna. Server pusat harus tetap hidup. HP yang mati tidak bisa mengirim data; wake lock tidak dapat membuat perangkat mati tetap bekerja.
- Arsip database tidak memiliki penghapusan otomatis berdasarkan umur. Pantau disk dan lakukan backup. Ekspor penuh memuat seluruh hasil terpilih ke memori; untuk arsip sangat besar, gunakan backup SQLite dan alat analisis database.
- Kelulusan tes perangkat lunak tidak membuktikan peningkatan akurasi jaringan. Bukti tersebut harus dilihat dari pengukuran lapangan baru dan pembandingan pada target yang sama.

## Reproduksi

```bash
npm ci
npm test
python -m pip install -r requirements.txt
python -m unittest discover -s tests -p 'test_*.py'
npm run build:public
```

Untuk uji kelompok, ikuti [Mulai di sini](MULAI_DI_SINI_V5.md): samakan project/broker/interval, bedakan ID HP, jalankan pusat, gunakan pengukuran nyata, lalu periksa grafik dan simpan backup. Catat kondisi jaringan serta jumlah target valid; jangan mengklaim MAE selalu turun.
