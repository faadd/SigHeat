# Opsi A: edge melalui browser HP

Opsi ini tidak memerlukan Termux, Python, aplikasi tambahan, PWA, atau ekstensi di HP. Dua HP membuka halaman HTTPS dan mengolah accelerometer serta gyroscope. Gunakan [Opsi B](ANDROID.md) jika ingin menjalankan edge melalui Termux + Python pada Android.

## 1. Terbitkan halaman HTTPS

1. Ekstrak ZIP pada laptop. Buka folder yang langsung berisi `index.html`, `dashboard.html`, `assets/`, dan README.
2. Buka repository kelompok. Bila perlu, gunakan branch baru untuk memeriksa perubahan sebelum mengganti versi yang sedang digunakan.
3. Pilih **Add file → Upload files**. Seret **isi folder proyek**, bukan ZIP dan bukan folder pembungkusnya. Pastikan `index.html` langsung berada di root dan `assets/` tetap utuh.
4. Sertakan `.nojekyll` pada root. Jika tidak ikut terunggah, buat file baru bernama `.nojekyll` dengan isi kosong. Jangan mengunggah `.env`, password, atau data lokasi pribadi.
5. Pada **Settings → Pages**, pilih **Deploy from a branch**, branch final, dan **/(root)**, lalu simpan.
6. Tunggu deployment selesai dan buka URL HTTPS dari **Visit site**. URL repository bukan URL aplikasi.

Untuk repository `faadd/SigHeat`, setelah deployment versi ini berhasil:

- Edge HP: `https://faadd.github.io/SigHeat/`
- Dashboard: `https://faadd.github.io/SigHeat/dashboard.html`

Periksa versi yang benar-benar terbuka. Mendapat ZIP revisi tidak otomatis mengubah GitHub. GitHub Pages melayani file statis; `server.py` dan `termux_edge.py` tidak dijalankan di sana.

## 2. Mulai pada dua HP

1. Buka URL HTTPS halaman edge pada browser utama HP. Browser dalam aplikasi chat bisa mempunyai dukungan izin berbeda.
2. Isi ID `hp-a` dan `hp-b`, Project ID yang sama, broker WSS yang sama, serta kredensial jika diperlukan.
3. Pilih pembagian lokasi **sebelum** menekan mulai. Lokasi opsional; tanpa lokasi, hasil tetap tampil di tabel.
4. Tekan **Mulai pengukuran**. Tombol meminta izin sensor dan menghubungkan broker; tidak ada tombol koneksi terpisah pada halaman edge.
5. Berikan izin gerakan/orientasi dan lokasi jika diminta. Tunggu beberapa detik, kemudian periksa kedua sensor, jumlah sampel, status koneksi, dan nomor telemetri.
6. Biarkan halaman tetap terlihat dan layar menyala. Tab yang tersembunyi menghentikan koneksi/listener sensor/lokasi sesi; kembali lalu tekan mulai lagi untuk sesi baru.
7. Tekan **Hentikan** untuk mengakhiri pengukuran.

Browser membaca `DeviceMotionEvent`. Percepatan linear dipakai jika valid; jika hanya percepatan termasuk gravitasi tersedia, program memakai pendekatan residual magnitude. `rotationRate` browser bersatuan derajat/detik dan dikonversi ke radian/detik sebelum integrasi. Lihat [rumus dan batasannya](PROTOCOL.md).

## 3. HTTPS, izin, dan jaringan lokal

Halaman edge membutuhkan secure context. `http://localhost` merujuk perangkat yang membuka alamat tersebut. **`http://192.168.x.x` milik laptop bukan localhost bagi HP**, sehingga HTTP LAN biasa tidak cukup untuk membaca sensor HP.

Untuk demo satu jaringan:

- Hubungkan dua HP dan laptop ke satu Wi-Fi/hotspot dengan internet.
- Kedua HP membuka halaman edge HTTPS yang telah diterbitkan.
- Laptop menjalankan `python server.py --port 8000` dan membuka dashboard lokal.
- Samakan broker WSS dan Project ID pada semua halaman.

Dashboard lokal tidak membaca sensor sehingga dapat memakai HTTP LAN. Jangan mengubah pengaturan keamanan browser untuk memaksa sensor melalui HTTP.

Pada browser yang menyediakan `DeviceMotionEvent.requestPermission()`, permintaan izin berasal dari klik tombol mulai. Jika izin ditolak, periksa pengaturan situs/browser lalu coba kembali. Jika perangkat tidak memiliki gyroscope, izin tambahan tidak dapat menciptakan sensor yang tidak ada.

## 4. Periksa sumber data

- `source: browser` berarti telemetry melalui jalur browser, bukan autentikasi pengirim broker.
- Accelerometer dan gyroscope harus sama-sama valid untuk bukti dua sensor. Data tidak tersedia tetap `null`, bukan nol atau angka simulasi.
- Latency adalah probe aplikasi browser → broker → browser sendiri. Tidak mengukur RSSI/RSRP, ping ICMP, atau throughput.
- Geolocation dapat berasal dari GPS atau sumber lain. Ia bukan pengganti gyroscope untuk menghitung dua sensor fisik.
- Mode contoh hanya untuk memahami UI. Jangan masukkan datanya ke laporan lapangan.

## 5. Jika belum bekerja

| Gejala | Pemeriksaan |
|---|---|
| Sensor tidak aktif | HTTPS, izin gerakan, browser utama, dan hardware |
| Gyroscope kosong | Coba browser/perangkat yang mendukung atau Opsi B; jangan isi nol |
| Dashboard kosong | Proyek dan broker sama; ID berbeda; tab edge sedang berjalan |
| Probe timeout | Internet, status subscription, broker, dan ACL probe |
| ACK tidak muncul | Edge aktif, target ID/sesi tepat, ACL command/ACK, waktu otomatis |
| Lokasi tidak terlihat | Pilihan berbagi sebelum mulai, izin lokasi, akurasi dan umur lokasi |
| Halaman lama setelah upload | Periksa deployment Pages dan URL, kemudian muat ulang |
| File web 404 | `index.html` di root; isi proyek tidak tertanam satu folder tambahan |

Untuk pengujian, gunakan [lembar rubrik/demo](RUBRIC_AND_DEMO.md). Hasil nyata pada dua HP masih perlu dicatat.

## Sumber

- README PocketGuard yang dilampirkan pengguna: pola Opsi A/Opsi B dan panduan bertahap.
- PDF tugas halaman 23: alternatif sensor melalui iPhone Safari/Android Chrome.
- [W3C Device Orientation and Motion](https://www.w3.org/TR/orientation-event/)
- [MDN: izin DeviceMotionEvent](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static)
- [W3C Geolocation](https://www.w3.org/TR/geolocation/)
- [GitHub Pages publishing](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
