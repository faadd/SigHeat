# Pemeriksaan paket SigHeat 3.0

Tanggal: 4 November 2026.

## Dasar dan perubahan

Paket dibuat dari `SigHeat-main (1)(1).zip` yang dilampirkan pengguna. Akses repositori melalui konektor GitHub tidak berhasil pada sesi pengerjaan, sehingga kesamaan dengan commit terbaru repository belum diverifikasi. Tidak ada push, perubahan branch, atau publikasi GitHub.

Fungsi dua HP Browser/Termux, MQTT, command/ACK, pengolahan sensor, dan peta tetap dipertahankan. Tambahan utama adalah `assets/ml.js`, `assets/ml-ui.js`, menu Prediksi ML, ekspor identitas sesi dalam CSV, CLI pelatihan, dataset sintetis, model contoh, serta dokumentasi. Tidak ada konfigurasi RouterOS, firewall, atau antrean perangkat jaringan yang diubah.

## Bukti pengujian

| Pemeriksaan | Hasil |
|---|---|
| `node --test tests/*.cjs` | 57 tes lulus, 0 gagal |
| `python -m unittest discover -s tests -p 'test_*.py'` | 26 dijalankan, 25 lulus, 1 dilewati |
| Penyebab tes Python dilewati | Paho MQTT tidak tersedia untuk pemeriksaan konteks TLS klien Paho nyata |
| Sintaks JS | `node --check` pada app.js, ml.js, ml-ui.js lulus |
| CLI pelatihan dari CSV sintetis | Berhasil; hasil model dan report deterministik |
| Verifikasi numerik terpisah | Koefisien Ridge cocok dengan solusi NumPy; galat selisih prediksi maksimum sekitar 1,72e-12 ms pada dataset contoh |
| Dashboard | Alur panel diperiksa memakai DOM tiruan dan engine ML sebenarnya |
| PDF pembahasan | Dibuat dan diperiksa melalui render halaman |

Satu tes yang dilewati bukan bukti bahwa TLS gagal. Pasang `requirements.txt` untuk menjalankan pemeriksaan tersebut pada lingkungan yang sesuai.

## Batas bukti

- Belum ada uji end-to-end menggunakan dua HP fisik dan broker kelompok.
- Belum ada pemeriksaan visual dashboard pada browser desktop/mobile; lingkungan browser tidak dapat mengakses server proyek.
- Dataset sumber tidak berisi histori pengukuran jaringan nyata untuk melatih model kelompok.
- Data dan metrik dalam `data/demo-synthetic.*` serta `models/demo/` bersifat sintetis. Angka tersebut tidak membuktikan performa pada Wi-Fi atau perangkat pengguna.
- Model terikat pada satu sesi boot dan konfigurasi. Panel belum menyediakan impor model; ekspor dapat dipakai melalui API JavaScript dan diperiksa sebagai hasil pelatihan.

Ikuti `AI_DEMO_DAN_PENGUJIAN.md` untuk uji lapangan. Paket memuat semua file sumber asli dan tambahan ML, tanpa cache Python, kredensial aktif, atau node_modules. Pustaka frontend vendor asli tetap disertakan.

`PACKAGE_MANIFEST.json` pada akar paket mencatat SHA-256 semua file paket selain manifest itu sendiri, hash ZIP sumber, serta daftar file yang berubah dan ditambahkan. Manifest membantu memeriksa integritas berkas; bukan tanda tangan digital.
