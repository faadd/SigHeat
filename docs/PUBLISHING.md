# Publikasi model dan GitHub Pages — SigHeat 5

Layanan pusat tetap mengumpulkan data dan melatih model walaupun publikasi GitHub belum diaktifkan. GitHub Pages menyajikan website dan parameter model; Pages **tidak menjalankan trainer atau listener MQTT**.

## Pengaturan satu kali

1. Pasang seluruh kode SigHeat 5 di repository Anda, termasuk folder `.github/workflows`. Contoh konfigurasi memakai `faadd/SigHeat` dan branch `main`.
2. Di GitHub buka **Settings → Pages → Build and deployment → Source → GitHub Actions**. Jalankan workflow **SigHeat Pages** sekali dari tab **Actions → Run workflow**. Jika branch Anda bukan `main`, ubah filter branch di `.github/workflows/pages.yml` serta konfigurasi pusat agar cocok.
3. Di mesin pusat, salin `.env.central.example` menjadi `.env.central`. Isi bagian publikasi berikut. Nilai token di bawah hanya petunjuk; jangan menyalinnya secara literal.

```dotenv
SIGHEAT_GITHUB_REPOSITORY=faadd/SigHeat
SIGHEAT_GITHUB_BRANCH=main
SIGHEAT_GITHUB_TOKEN=ISI_TOKEN_DI_MESIN_PUSAT_SAJA
SIGHEAT_PAGES_URL=https://faadd.github.io/SigHeat
SIGHEAT_PUBLISH_COALESCE_SECONDS=60
```

Gunakan fine-grained personal access token yang hanya mencakup repository tujuan, dengan izin **Contents: Read and write** untuk menyimpan model, serta **Actions: Read and write** untuk meminta deployment. Token ini tidak dimasukkan ke HTML, JavaScript, pengaturan dashboard, cadangan model publik, ataupun percakapan. Jika kebijakan branch melarang push langsung, konfigurasi branch publikasi yang diizinkan sesuai kebijakan repository; penerbit tidak memakai force push untuk melewatinya.

4. Jalankan `npm run central`. Token dan repository yang kosong berarti publikasi dinonaktifkan. Antrean tetap tersimpan dan model pusat masih dapat dibaca lewat API pusat.
5. Periksa status publikasi pada rincian pembelajaran. Status **committed** berarti berkas sudah ada di GitHub; status **deployed** hanya muncul setelah penerbit berhasil membaca manifest **dan** artefak yang checksum-nya cocok dari URL Pages.

Layanan pusat memerlukan internet keluar menuju broker, `api.github.com`, dan URL Pages. API pusat sendiri memakai pengaturan HTTPS/CORS yang dijelaskan pada panduan utama; URL Pages bukan alamat backend pusat.

## Yang berlangsung otomatis

Perubahan parameter aktif, pergantian metode aktif, atau konteks baru membuat paket parameter terbaru. Kandidat yang ditolak tidak dimasukkan sebagai model aktif. Pembaruan digabung selama 60 detik agar tidak membuat commit tiap pengukuran. Paket hanya memuat parameter, identitas konteks, asal model, konfigurasi, waktu model, serta ringkasan numerik yang diizinkan. Data pengukuran, GPS, cadangan browser, dan kredensial tidak ikut dipublikasikan. Identitas proyek/perangkat dan URL broker tanpa kredensial merupakan metadata publik dalam paket ini.

Setiap paket memiliki:

- `models/releases/model-<hash>.json`: artefak parameter berversi yang tidak ditimpa.
- `models/latest.json`: manifest berisi versi, lokasi artefak, jumlah byte, SHA-256, dan revisi model.

Penerbit menulis artefak dan manifest dalam satu commit dengan Git Database API. Update branch selalu `force:false`. Jika ada commit bersamaan, percobaan berikutnya membaca head terbaru dan membangun commit baru di atasnya. Jika commit sebelumnya sebenarnya berhasil tetapi respons terputus, isi manifest dan artefak diperiksa sehingga tidak dibuat commit identik lagi.

Setelah commit, penerbit memanggil `workflow_dispatch` secara eksplisit. Jangan mengganti langkah ini dengan asumsi bahwa commit dari `GITHUB_TOKEN` selalu memicu workflow lain. Workflow membuat direktori `public-dist`, mengunggahnya sebagai artefak Pages, kemudian menjalankan deployment. Push kode oleh pengguna juga dapat memicu workflow; duplikasi permintaan deployment dikelola melalui kelompok concurrency workflow.

Browser memeriksa manifest berkala, dengan interval awal 60 detik. Browser baru tidak harus memakai browser/profil laptop lama. Jika API pusat dipakai, model aktif pusat dapat diperoleh sebelum publikasi Pages selesai. Jika sumber model berupa Pages, browser mengikuti versi yang sudah tersedia di Pages. Waktu publikasi dan polling membuat jeda yang wajar; ini bukan jaminan pembaruan tanpa jeda.

## Arti status

| Status | Makna |
|---|---|
| Model pusat aktif | Engine pusat sudah menggunakan parameter/metode tersebut. |
| `queued` | Paket menunggu waktu penggabungan atau giliran publikasi. |
| `committed` | Paket sudah tersimpan di branch GitHub tujuan. |
| `dispatched` | Workflow deployment sudah diminta; Pages belum diverifikasi. |
| `deployed` | Manifest dan byte artefak di Pages sudah cocok dengan paket. |
| `failed` | Batas percobaan tercapai. Model pusat dan cache browser tetap tersedia. |
| Cache terakhir | Browser belum berhasil mengambil versi baru; tampilkan versi cache dan waktu sinkronisasi. |

Field `published_at_ms` pada manifest adalah waktu manifest paket dibuat. Bukti waktu ketertersediaan publik sebenarnya berada pada `committed_at_ms` dan `deployed_at_ms` di status/audit penerbit. Jangan menyamakan ketiganya.

## Jika publikasi gagal

Setiap tahap yang gagal dicoba paling banyak lima kali dengan jeda bertambah, mulai 30 detik. Ketidakcocokan versi yang masih tersaji di Pages juga dihitung sebagai percobaan verifikasi; deployment yang sangat lambat dapat mencapai status gagal tanpa mengubah model pusat. Periksa tab **Actions**, izin token, kedaluwarsa token, nama branch, pengaturan Pages, jaringan, dan URL Pages.

Setelah diperbaiki, hentikan layanan pusat dengan **Ctrl+C**, jalankan:

```sh
npm run central:retry
npm run central
```

Retry melanjutkan tahap yang gagal. Jika commit sudah berhasil, tahap dispatch/verifikasi dapat dilanjutkan tanpa mengulang commit. Riwayat publikasi berada di `SIGHEAT_DATA_DIR/publication/publication-events.jsonl`; antrean di `publisher.json`. Berkas tersebut berada di penyimpanan privat dan ikut dalam cadangan pusat. Jangan menghapus antrean untuk menyembunyikan kegagalan.

## Rollback model

Cadangkan pusat dahulu. Hentikan layanan pusat. Pilih **versi artefak** `model-...` yang masih ada dalam `SIGHEAT_DATA_DIR/models/releases`, lalu jalankan:

```sh
npm run central:rollback -- --version model-GANTI_DENGAN_VERSI --reason "Model sebelumnya dipilih setelah pemeriksaan"
npm run central
```

Perintah ini memulihkan parameter dan metode untuk konteks yang ada dalam artefak lama, mempertahankan data/riwayat, membatalkan pasangan prediksi dan evaluasi kandidat yang sedang menunggu secara tercatat, serta membuat revisi pusat baru. Konteks lain yang muncul setelah artefak lama dibuat tetap dipertahankan. Paket baru kemudian dipublikasikan lewat antrean yang sama. Model awal beku tetap menjadi pembanding. Riwayat metrik lama tidak dihitung ulang.

Implementasi `ArtifactStore.rollback` juga mendukung **rollback publikasi saja**: manifest publikasi baru menunjuk byte artefak lama. Fungsi tersebut bukan perintah rollback pusat yang dianjurkan, karena subset konteks pada artefak lama mungkin berbeda dengan keadaan pusat saat ini. Gunakan perintah CLI di atas untuk menjaga kesesuaian pusat dan paket publik.

## Memeriksa isi yang akan diterbitkan

```sh
npm run build:public
```

Periksa direktori `public-dist`. Isinya hanya halaman, aset UI yang diizinkan, dan parameter model yang lolos pemeriksaan schema/checksum. Folder `private-data`, `server`, `tests`, `docs`, `data`, `node_modules`, serta `.env` tidak masuk build. File seed pembelajaran browser selalu diganti dengan seed kosong pada build publik sehingga cadangan lokal tidak terpublikasi tanpa sengaja. Pada instalasi awal tanpa `models/latest.json`, build menghasilkan paket bootstrap sintetis yang diberi revisi 0; ini bukan hasil pengukuran nyata.

Jangan memilih root repository sebagai artefak upload Pages. Gunakan workflow yang disertakan. Build menolak symlink dan artefak model dengan field tambahan yang tidak diizinkan. SHA-256 memeriksa integritas byte, bukan menggantikan kepercayaan terhadap sumber HTTPS/repository.

## Batas pengujian dan rujukan

Pengujian otomatis publisher memakai respons GitHub/Pages tiruan deterministik: antrean, konflik branch, respons terputus, retry, batas retry, checksum, deployment tertunda, rollback, dan pencegahan rahasia masuk paket diuji sebagai perilaku perangkat lunak. Paket ini tidak mengklaim token akun pengguna, push GitHub, atau deployment nyata telah diuji.

Dokumentasi resmi diperiksa pada 6 November 2026:

- [Workflow khusus GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
- [GITHUB_TOKEN dan pemicu workflow](https://docs.github.com/en/actions/concepts/security/github_token).
- [REST API pembaruan Git reference](https://docs.github.com/en/rest/git/refs#update-a-reference).

Workflow memakai `configure-pages@v5`, `upload-pages-artifact@v4`, dan `deploy-pages@v4` sesuai dokumentasi Pages yang diperiksa. Perizinan deployment dibatasi pada `pages:write`, `id-token:write`, dan akses baca repository untuk build.
