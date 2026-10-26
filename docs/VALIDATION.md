# Validasi SigHeat v2.1: dua opsi edge

## Hasil pemeriksaan, 26 Oktober 2026

**33 tes JavaScript dan 26 tes Python lulus** pada Node.js 24.22.1 dan Python 3.12.14, dengan paho-mqtt 2.1.0 dan python-dotenv 1.1.1. Pemeriksaan menggunakan data sintetis dan broker tiruan, kecuali tes server HTTP lokal dan konfigurasi objek Paho yang sebenarnya. Belum ada uji dua HP fisik atau broker cloud kelompok.

Jalankan dari folder proyek pada laptop pengembangan:

```bash
python -m pip install -r requirements.txt
node --test tests/*.cjs
python -m unittest discover -s tests -p 'test_*.py' -v
```

Node.js hanya untuk tes pengembangan. Opsi A tidak membutuhkan Node.js, Python, atau Termux pada HP. Server dashboard `server.py` hanya memakai pustaka standar Python.

## Cakupan tes

| Area | Hasil dan batas bukti |
|---|---|
| Protokol bersama dan processing browser | Validasi payload, null, RMS, konversi gyro, integral, replay sesi, CSV, grid dan filter sumber lulus |
| Edge browser | Izin dari gesture, probe nonce, timeout, SUBACK, command/ACK, cleanup saat stop/tab tersembunyi lulus dengan API tiruan |
| Edge Termux | Parsing JSON bertahap/UTF-8, pemilihan sensor, RMS, gyro rad/s, integral waktu kedatangan, gap, data hilang dan batas buffer lulus |
| MQTT Termux | Callback Paho tiruan memverifikasi SUBACK, echo pertama, nonce, TTL, sesi, retained, duplikasi dan cooldown; objek Paho nyata mempertahankan verifikasi TLS/hostname |
| Integrasi lintas bahasa | Payload yang dibuat Python diterima validator JavaScript; sumber, endpoint dan unit konsisten; sensor/probe gagal tetap null |
| Server laptop | Halaman publik dapat diakses; `.env`, Python, traversal, symlink, NUL dan metode mutasi ditolak |
| Penghentian proses | Proses sensor milik aplikasi dihentikan dan diambil status akhirnya; cleanup tetap berjalan saat disconnect gagal |

Berkas tes: `test_core.cjs`, `test_edge.cjs`, `test_integration.cjs`, `test_dual_contract.cjs`, `test_termux.py`, `test_dual_integration.py`, dan `test_server.py` di folder `tests/`.

## Pemeriksaan antarmuka

Antarmuka diperiksa di browser desktop dan frame 390 px. Lebar konten pada frame adalah 375 px setelah scrollbar, tanpa overflow horizontal pada halaman kontributor dan dashboard. Frame ini menguji tata letak, bukan perilaku Chrome/Safari pada HP fisik.

Harness terpisah memakai dua halaman kontributor dengan sensor/lokasi dan MQTT tiruan. Untuk menguji tampilan dua sumber, payload halaman kedua diberi label `termux` oleh harness; ini bukan pengujian runtime Android. Dashboard menampilkan kedua sumber, menonaktifkan rerata/grid gabungan, lalu menampilkan hanya HP B saat filter Termux dipilih. Perintah `sample_now` ditujukan ke HP B dan mendapat ACK. Pratinjau CSV hanya memuat baris sumber Termux serta label sumbernya. Harness tidak disertakan dalam ZIP dan tidak mengirim pesan ke broker publik.

Pemeriksaan browser sebelumnya juga mencakup `set_interval`, salin CSV, timeout echo menjadi null, penghentian sesi dan pengaktifan kembali tombol mulai. Tes otomatis rilis ini memeriksa ulang perilaku command, timeout dan cleanup. Pengiriman berkas CSV ke perangkat pengguna belum diverifikasi; pratinjau/salin tetap tersedia.

## Uji lapangan yang masih diperlukan

| Area | Status | Bukti kelompok |
|---|---|---|
| Dua HP browser dengan dua sensor | Belum diuji | Model, OS/browser, izin, perubahan sensor, video |
| Dua Android Termux dengan dua sensor | Belum diuji | Model, versi Termux/API, hasil `--check-sensors`, video |
| Broker cloud nyata | Belum diuji | Log WSS, subscription, probe, telemetry dan ACK |
| Lokasi/akurasi | Belum diuji | Izin, akurasi, waktu dan konteks titik pengamatan |
| Dashboard pada LAN kelompok | Belum diuji | IP laptop, jaringan yang sama dan akses dashboard |
| Keunikan ide | Perlu diperiksa | Konfirmasi sheet kelas |

Gyro browser dikonversi dari derajat/detik; gyro Termux sudah radian/detik. Termux menggunakan waktu kedatangan snapshot API, sehingga tes tidak membuktikan kesegaran fisik nilai yang mungkin di-cache atau akurasi integral hardware. Data contoh tidak boleh digunakan sebagai hasil lapangan. Sumber merupakan label runtime, bukan autentikasi identitas pengirim.

## Acuan

PDF tugas, screenshot ketentuan, dan README PocketGuard yang dilampirkan pengguna telah diperiksa. Struktur README SigHeat mengadaptasi urutan laptop, Opsi A browser, Opsi B Termux, dan uji sistem. Hasil uji perangkat nyata dicatat pada [RUBRIC_AND_DEMO.md](RUBRIC_AND_DEMO.md).
