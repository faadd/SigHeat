# Mode Heatmap SigHeat 4.1

**Mode Heatmap** berada tepat di sebelah **Peta jalan**. Mode ini menampilkan area warna yang mengikuti sebaran pengamatan dengan bentuk tidak beraturan. Perhitungan dilakukan lokal di browser menggunakan Canvas dan Leaflet yang sudah disertakan; tidak memerlukan API key, akun peta tambahan, atau layanan heatmap berbayar.

## Cara mencoba

1. Jalankan `python server.py --port 8000`, lalu buka `http://localhost:8000/dashboard.html`.
2. Untuk pemeriksaan cepat, aktifkan **Contoh lokal**, lalu tekan **Mode Heatmap**. Contoh tetap diberi label sintetis dan tidak memperbarui model pengukuran nyata.
3. Untuk pengukuran nyata, hubungkan HP ke proyek dan broker yang sama, lalu aktifkan berbagi lokasi. Tunggu telemetri dengan koordinat dan kategori ML yang valid.
4. Pilih **Semua titik** untuk menyesuaikan tampilan. Geser atau perbesar peta untuk memeriksa area; klik titik kecil untuk melihat perangkat, RTT, kategori, dan model yang digunakan.
5. Baca legenda di bawah peta. Saat kembali ke **Titik**, **Grid 25 m**, atau **Peta jalan**, legenda untuk mode tersebut kembali ditampilkan.

Jika **Mode Heatmap** dinonaktifkan, periksa filter sumber dan interval perangkat. Heatmap tidak menggabungkan kategori relatif dari konteks proyek, sumber, broker, atau interval yang berbeda. Kedua HP pada konteks yang sama memakai classifier K-Means bersama.

## Arti warna

| Tampilan | Makna |
|---|---|
| Ungu `#440154` | Beban koneksi relatif rendah menurut kelompok ML |
| Hijau kebiruan `#21918c` | Beban koneksi relatif sedang |
| Kuning `#fde725` | Beban koneksi relatif tinggi |
| Warna peralihan | Campuran nilai kelompok pengamatan di sekitar lokasi yang digambar |
| Titik abu-abu | Timeout, kategori belum diketahui, atau akurasi lokasi yang diketahui lebih buruk dari 35 m; tidak menyumbang warna area |
| Area tanpa warna | Tidak didukung pengamatan yang memenuhi syarat dalam radius penghalusan; bukan tanda bahwa koneksinya baik |

Ramp memakai lima jangkar warna berurutan: ungu, biru, hijau kebiruan, hijau, dan kuning. Teks rendah/sedang/tinggi disertakan agar pengguna tidak perlu mengandalkan warna saja. Legenda heatmap berbeda dari legenda titik/grid karena heatmap menyajikan transisi nilai, bukan hanya tiga kategori diskret.

Kategori berasal dari K-Means yang mempelajari RTT, variasi RTT, dan keberhasilan probe. Ia tidak memakai lagi batas kualitas RTT 150/500 ms. Rendah dan tinggi bersifat **relatif terhadap model**, bukan standar mutu jaringan universal. Label model awal sintetis atau model hasil pengukuran tetap tersedia pada dashboard.

## Dari titik menjadi area tidak beraturan

1. Dashboard memakai pengamatan berlokasi yang sedang tampil setelah filter sumber. Riwayat peta dibatasi pada **1.000 pengamatan terbaru sesi dashboard**; ini bukan seluruh riwayat training yang tersimpan di browser.
2. Classifier aktif memberi kelompok rendah/sedang/tinggi. Untuk menggambar, kelompok tersebut dipetakan ke nilai ordinal `0`, `0,5`, dan `1`. Angka ini bukan milidetik, probabilitas, atau persentase kualitas.
3. Pengamatan dalam sel geografis sekitar **2 m** diringkas menjadi satu rerata nilai. Setiap sel menyumbang satu lokasi, sehingga lokasi yang diukur berulang tidak menjadi lebih panas hanya karena jumlah sampelnya lebih banyak. Perubahan kategori dalam satu sel tetap dapat mengubah reratanya.
4. Setiap lokasi memberi pengaruh terbatas sampai **35 m**. Bobot menurun dengan jarak menggunakan kernel kompak `w = (1 - (d / 35)^2)^2` untuk `d < 35 m`; di luar itu bobot nol.
5. Nilai area adalah rerata berbobot: `sum(w × nilai) / sum(w)`. Radius dihitung dalam meter lalu diproyeksikan ke layar, sehingga memperbesar peta tidak mengubah radius geografis. Gabungan dukungan lokasi membentuk area berkelok, bukan kotak grid 25 m.
6. Transparansi mengikuti bobot lokasi terkuat dan memudar di tepi. Menumpuk titik tidak menjumlahkan intensitas seperti heatmap kepadatan. Area tanpa dukungan tetap transparan.

Saat model K-Means aktif berubah, kategori pengamatan yang terlihat dihitung ulang dan heatmap ikut diperbarui. Ini adalah **penghalusan spasial hasil kelompok ML**, bukan model AI tambahan yang telah membuktikan kondisi seluruh wilayah di antara titik. Angka prediksi Ridge tetap ditampilkan terpisah.

## Data kosong dan ketidakpastian lokasi

Pengamatan tanpa koordinat tidak dapat dipetakan. Timeout dan kategori yang belum diketahui tidak diberi nilai nol, karena nol akan tampak seperti beban rendah. Bila `accuracy_m` diketahui dan melebihi 35 m, lokasi itu tidak membentuk permukaan warna. Titiknya masih dapat dilihat sebagai abu-abu.

Bila akurasi lokasi tidak tersedia, pengamatan berkoordinat masih dapat dipakai, tetapi dashboard menampilkan catatan jumlah pengamatan dengan akurasi GPS yang belum diketahui. Ketelitian lokasi indoor dapat jauh lebih buruk dari di luar ruangan; radius 35 m adalah pilihan visualisasi, bukan bukti cakupan radio, batas gedung, atau resolusi GPS.

Jika peta terlalu jauh sehingga radius 35 m tidak terbaca, dashboard meminta pengguna memperbesar peta. **Semua titik** membantu menemukan kembali lokasi ketika pengamatan berada di luar tampilan.

## Gratis dan kebutuhan jaringan

Engine `assets/heatmap.js` dan adapter `assets/heatmap-layer.js` tidak mengirim data ke API heatmap eksternal. Keduanya bekerja dengan pustaka Leaflet lokal dan Canvas browser; tidak ada dependensi atau langganan tambahan.

Peta jalan menggunakan tile standar OpenStreetMap pada `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, dengan atribusi yang terlihat dan kebijakan referrer yang sesuai. Layanan tile bersifat best-effort, bukan jaminan ketersediaan atau kapasitas tanpa batas. Aplikasi tidak menambahkan unduhan massal, prefetch, atau penyimpanan tile offline. Jika peta dasar gagal dimuat, permukaan heatmap tetap tampil pada latar polos dan dashboard memberi keterangan.

Acuan diperiksa 4 November 2026: [OpenStreetMap Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) dan [Leaflet 1.9.4](https://leafletjs.com/reference-1.9.4.html). Koneksi pengukuran tetap mengikuti kebutuhan broker MQTT yang digunakan kelompok.

## File dan verifikasi

- `assets/heatmap.js`: pengelompokan lokasi, kernel ternormalisasi, warna, dan batas penggunaan memori/komputasi.
- `assets/heatmap-layer.js`: lapisan Canvas Leaflet, pembaruan saat peta digeser/diperbesar/diubah ukurannya, dan pembersihan saat berganti mode.
- `dashboard.html`, `assets/app.js`, `assets/style.css`: tombol, integrasi pengamatan, legenda, status, dan tampilan responsif.
- `server.py`: kebijakan pemuatan gambar mengizinkan hostname tile OpenStreetMap yang digunakan.
- `tests/test_heatmap.cjs`, `tests/test_heatmap_ui.cjs`: pemeriksaan engine, mode dashboard, dan adapter Canvas.

Jalankan `npm test` untuk pemeriksaan JavaScript. Bukti yang benar-benar dijalankan serta batas pemeriksaan visual/perangkat tercatat pada `RELEASE_VALIDATION.md`. PDF versi 4 tetap menjelaskan pembelajaran otomatis Ridge dan K-Means; panduan tambahan heatmap adalah dokumen ini.
