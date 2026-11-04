# Upgrade SigHeat ke versi 4.0

Versi 4 menerapkan permintaan percakapan kelompok: model awal tersedia tanpa training manual, pembelajaran dilanjutkan otomatis dari telemetri baru, dan kategori dashboard dipelajari dengan K-Means. Tab Prediksi ML dihapus; ringkasan prediksi serta kategori berada di halaman peta.

## Perubahan dari versi 3

| Versi 3 | Versi 4 |
|---|---|
| Tab Prediksi ML dan tombol latihan | Ringkasan otomatis di halaman peta; rincian opsional pada halaman yang sama |
| Regresi dilatih lewat kontrol pengguna | Parameter awal dimuat langsung; kandidat baru disusun otomatis |
| Kategori memakai aturan RTT tetap | K-Means mempelajari centroid untuk tiga kategori beban relatif |
| State ML terutama hidup selama halaman terbuka | Model dan riwayat fitur terbatas disimpan pada browser/origin yang sama |
| Model/sesi terkait boot tertentu | Model regresi terkait konteks perangkat; boot tetap membatasi window input |
| Ekspor model tunggal | Cadangan versi 4 berisi konteks, model, dan riwayat fitur |

Tidak ada perintah perubahan RouterOS, firewall, atau antrean jaringan. Integrasi AI bekerja pada dashboard setelah telemetri diterima. Kode edge dan format protokol lama tetap didukung. Field `connection_quality` lama dapat tetap dikirim, tetapi dashboard versi 4 tidak memakainya untuk menentukan kategori.

## Memasang paket lengkap

1. Cadangkan folder kerja lama dan data percobaan yang ingin dipertahankan.
2. Ekstrak ZIP versi 4. Salin **isi folder proyek** ke root repository SigHeat yang sudah ada; jangan membuat lapisan `SigHeat/SigHeat-main` tambahan.
3. Sertakan semua aset baru di folder `assets/`, bukan hanya `dashboard.html`. Halaman memerlukan engine, model awal, manager pembelajaran, dan panel yang saling cocok.
4. Pertahankan konfigurasi lokal broker dan `.env` pada komputer masing-masing. Jangan memasukkan kredensial ke GitHub.
5. Jalankan `python server.py --port 8000`, buka `http://localhost:8000/dashboard.html`, lalu lakukan reload penuh bila browser masih menampilkan tampilan lama.
6. Hubungkan HP dengan broker, proyek, dan prosedur yang sama seperti versi sebelumnya. Pilih perangkat pada halaman peta.

Halaman peta menampilkan **Pembelajaran otomatis**, **Prediksi RTT berikutnya**, dan **Kelompok koneksi**. Bawaan paket dapat melakukan inferensi setelah enam RTT valid tanpa menunggu penyesuaian model dari data nyata. **Rincian pembelajaran & cadangan** menyediakan status dan pengelolaan data, bukan tombol training.

## Apa yang dimuat ketika dashboard dibuka?

Urutan sumber pembelajaran adalah:

1. Cadangan lokal yang valid dari browser/origin tersebut.
2. Model awal kelompok yang dikemas dalam `assets/learning-seed.js`, bila tersedia dan valid.
3. Model Ridge serta centroid K-Means bawaan sintetis untuk konteks yang belum memiliki model kelompok.

Paket awal menyertakan `learning-seed.js` kosong; belum ada histori lapangan kelompok yang dapat diklaim sebagai model nyata. Artefak sintetis bukan hasil pengukuran Wi-Fi kampus. Model kelompok maupun model lokal tetap hanya dipakai pada konteks yang cocok.

## Menyiapkan hasil belajar kelompok sebelum demo

Prosedur ini dilakukan pengembang/kelompok sekali sebelum presentasi. Penonton atau pengguna dashboard tidak diminta melakukannya.

1. Jalankan pengukuran nyata melalui HP dengan proyek, ID perangkat, runtime, broker, interval, dan mode sensor yang akan dipakai saat demo.
2. Biarkan data terkumpul dan pembandingan otomatis berjalan. Kandidat pertama memerlukan sedikitnya 120 baris konteks regresi atau 90 baris konteks clustering, lalu 24 pengamatan baru yang valid untuk pembandingan. Data tidak lengkap dapat menambah waktu tunggu.
3. Periksa asal model aktif. Cadangan baru bisa dikemas sebagai hasil training kelompok bila sedikitnya satu model aktif telah berasal dari pengukuran. Kandidat yang belum dipromosikan tidak cukup untuk klaim itu.
4. Pilih **Unduh cadangan pembelajaran**. Dari root proyek, jalankan perintah berikut dengan path file unduhan yang benar:

```bash
node scripts/build-learning-seed.cjs --input sigheat-pembelajaran.json
```

5. Periksa perubahan `assets/learning-seed.js`, terutama metadata proyek/perangkat dan alamat broker yang akan menjadi aset situs. Builder hanya menyalin field yang telah divalidasi; koordinat GPS dan kredensial tidak disertakan.
6. Commit aset tersebut bersama kode versi 4. Pada browser baru, dashboard memuat pembelajaran yang sesuai secara otomatis. Tidak ada import atau training manual pada alur demo.

Cadangan lokal valid lebih diprioritaskan daripada seed paket. Untuk menguji seed baru, pakai profil browser yang belum berisi data situs. Alternatifnya, hentikan koneksi, unduh cadangan lama, pilih **Hapus pembelajaran tersimpan**, lalu refresh sebelum menerima telemetri baru. Penghapusan mengaktifkan bootstrap pada halaman saat itu; seed paket dibaca kembali saat halaman diinisialisasi.

Mengemas hasil belajar tidak membuat model cocok untuk semua perangkat. Broker ngrok yang berubah, proyek berbeda, atau interval baru membentuk konteks baru. Model regresi juga dibedakan menurut perangkat dan mode accelerometer. Perubahan `boot_id` tidak mengganti identitas model, tetapi enam RTT untuk inferensi tidak boleh menyambung boot lama dan baru.

## Kompatibilitas data lama

- JSON model tunggal versi 3 bukan cadangan pembelajaran versi 4 dan ditolak oleh kontrol pemulihan.
- `scripts/train-ml.cjs` serta dataset/model demo versi 3 tetap tersedia. Tanpa `--context`, eksperimen memakai satu aliran/sesi; opsi `--context` menerima beberapa boot dalam konteks yang cocok tanpa menyambungkan window antarsesi. Outputnya tidak otomatis menjadi state dashboard versi 4.
- Cadangan versi 4 memiliki format terstruktur yang divalidasi. Jangan menyunting array internal, source, atau provenance untuk membuat data sintetis terlihat nyata.
- Model yang dipulihkan tidak membuat data lama dihitung sebagai pengamatan live. Penilaian kandidat yang belum selesai dimulai ulang pada data baru setelah pemulihan.

## Retensi dan verifikasi

Penyimpanan dibatasi hingga 12 konteks regresi dan 12 konteks clustering, masing-masing paling banyak 1.200 baris terbaru. Konteks yang paling dahulu dibuat dapat tersisih jika batas tercapai. Data tidak disinkronkan otomatis ke laptop lain. Unduh cadangan jika ingin memindahkan pembelajaran atau mempertahankan hasil eksperimen.

Jalankan pemeriksaan pada `docs/AI_DEMO_DAN_PENGUJIAN.md`. Status pengujian paket tercatat pada `docs/RELEASE_VALIDATION.md`; tes software tidak membuktikan keberhasilan sensor, broker, atau Wi-Fi kelompok. File ZIP tidak otomatis mengubah repository GitHub atau situs yang sudah terbit.
