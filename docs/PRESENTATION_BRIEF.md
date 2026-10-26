# Brief PPT SigHeat: dua opsi edge

Gunakan bahasa Indonesia, identitas kelompok, dan hasil pengujian aktual. Delapan slide berikut menjelaskan masalah, arsitektur, sensor, processing, cloud, dashboard, hasil, dan pengumpulan. Brief menyediakan copy dan elemen visual; bukan PPT yang telah dirender.

**Argumen:** Dua HP dapat menjadi edge multisensor melalui browser atau Termux untuk mengamati kualitas koneksi aplikasi melalui MQTT, dengan bukti pengukuran dan batas klaim yang jelas.

| Slide | Bagian     | Headline persis                                                                                                                     | Peran                                          |
| ----: | ---------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
|     1 | Ide        | SigHeat memungkinkan dua HP mengamati kualitas koneksi dan membandingkan hasil pada titik yang diukur melalui dua pilihan edge.              | Menjelaskan manfaat dan lingkup                |
|     2 | Arsitektur | Dua pilihan edge memakai sensor dan protokol yang sama, sehingga kelompok dapat memilih browser atau Termux pada HP.                      | Menunjukkan edge, cloud, dan jaringan          |
|     3 | Sensor     | Accelerometer dan gyroscope menyediakan dua sumber sensor nyata, sedangkan lokasi memberi konteks tambahan pada pengamatan. | Menjelaskan sensor dan batas lokasi            |
|     4 | Processing | RMS percepatan dan integrasi rotasi mengolah gerakan, sementara statistik probe merangkum respons koneksi aplikasi melalui broker.  | Membuktikan algoritma dan unit                 |
|     5 | Dua arah   | Probe dan perintah memakai identitas pesan yang diperiksa, sehingga respons perangkat dapat ditelusuri tanpa menebak dari tampilan. | Menjelaskan telemetry, command, ACK            |
|     6 | Dashboard  | Dashboard memisahkan data riil, contoh, dan data tidak segar agar titik pengamatan tidak dibaca sebagai cakupan radio.              | Memperlihatkan penggunaan UI                   |
|     7 | Pengujian  | Bukti dua HP harus mencakup sensor, probe, perintah, dan kegagalan sebelum kelompok menyatakan demo berhasil.                       | Melaporkan hasil secara jujur                  |
|     8 | Penutup    | Kode, hasil pengamatan, dan video yang dapat diulang menjadi dasar penilaian SigHeat serta perluasan titik pengujian.               | Mengikat keluaran tugas dan langkah berikutnya |

## Audit sumber

| ID  | Sumber                               | Klaim yang didukung                                      | Batas                                       |
| --- | ------------------------------------ | -------------------------------------------------------- | ------------------------------------------- |
| S1  | PDF tugas, h.14–15                   | Ketentuan, bobot, keluaran                               | Tidak memberikan hasil SigHeat              |
| S2  | PDF, h.18–20 dan 23                  | Contoh accelerometer/gyroscope, RMS/rotasi, browser edge | Dukungan HP kelompok belum dibuktikan       |
| S3  | Percakapan kelompok                  | Tujuan membandingkan titik dan pengamatan bersama        | Bukan survei kebutuhan atau data cakupan    |
| S4  | Kode SigHeat v2, browser dan Termux                      | Alur, schema, perhitungan, validasi                      | Perilaku hardware/broker tetap perlu diuji  |
| S5  | VALIDATION.md dan lembar uji aktual  | Hasil pemeriksaan yang benar-benar dicatat               | Data mock/demo tidak menjadi bukti lapangan |
| S6  | Dokumentasi primer dalam PROTOCOL.md | API sensor/lokasi dan secure context                     | Tidak menetapkan ambang kualitas SigHeat    |

README PocketGuard yang dilampirkan pengguna telah diperiksa dan dipakai sebagai panduan struktur dua opsi. Brief tetap mengikuti fungsi SigHeat dan ketentuan PDF. Semua nilai percobaan di bawah diberi label ilustrasi. Jangan mengubah “belum diuji” menjadi “berhasil” tanpa bukti.

## Slide 1 · Ide dan batas lingkup

**Headline:** SigHeat memungkinkan dua HP mengamati kualitas koneksi dan membandingkan hasil pada titik yang diukur melalui dua pilihan edge.

**Tujuan/penghubung:** Memperkenalkan manfaat yang dituju kelompok sebelum menjelaskan arsitektur.

**Layout:** Dua modul. Kiri masalah/pengguna, kanan pembedaan metrik. Nama kelompok dan anggota kecil di bawah judul.

### 1. Pengamatan bersama memberi dasar untuk membandingkan pengalaman koneksi antartitik.

**Copy slide:** Ide kelompok berawal dari kebutuhan mengenali perbedaan koneksi di beberapa titik. **SigHeat mengumpulkan hasil dua HP**, lalu menampilkan waktu respons dan keberhasilan pesan pada lokasi pengamatan.

**Visual/data lengkap:** Tiga baris “Pengguna: komunitas kecil/kampus”; “Tindakan: menjalankan browser atau Termux pada dua HP”; “Manfaat yang dituju: membandingkan respons koneksi pada titik terukur”.

**Highlight:** “Titik terukur”. **Sumber/catatan:** S3; manfaat adalah tujuan desain, belum survei pengguna.

### 2. Browser mengukur respons pesan aplikasi, bukan kekuatan radio dBm.

**Copy slide:** Pesan probe dikirim dari HP melalui broker lalu kembali ke HP. **Durasi itu adalah roundtrip aplikasi MQTT**. Hasil tidak menyatakan RSSI, RSRP, ping ICMP, ataupun kecepatan unduh.

**Visual/data lengkap:** Tabel “Diukur: roundtrip ms, variasi ms, keberhasilan probe %”; “Tidak diukur: RSSI/RSRP dBm, throughput Mbps, packet loss IP”.

**Highlight:** “Roundtrip aplikasi MQTT”. **Sumber/catatan:** S4; jalur broker, browser, dan perangkat ikut memengaruhi hasil.

## Slide 2 · Arsitektur

**Headline:** Dua pilihan edge memakai sensor dan protokol yang sama, sehingga kelompok dapat memilih browser atau Termux pada HP.

**Tujuan/penghubung:** Menghubungkan dua edge, broker cloud, dan dashboard LAN; berikutnya perinci sensor.

**Layout:** Diagram top-down terbesar; tabel peran kecil di sisi kanan. Tunjukkan batas LAN dan broker di luar batas tersebut.

### 1. Setiap HP menjalankan satu pilihan edge dengan identitas yang berbeda.

**Copy slide:** HP A dan HP B memakai browser HTTPS atau Termux + Python. **Keduanya membaca dua sensor dan memakai protokol yang sama**, dengan ID berbeda dan proyek kelompok yang sama.

**Visual/data lengkap:** Label diagram: “HP A · hp-a · browser/Termux”, “HP B · hp-b · browser/Termux”, “Wi-Fi/hotspot bersama”, “Broker MQTT cloud · WSS”, “Laptop dashboard LAN”. Panah edge→broker: telemetry/ACK; broker→edge: command; edge↔broker: probe/echo.

**Highlight:** Dua HP fisik. **Sumber/catatan:** S1–S4; dua tab pada satu laptop bukan dua HP.

### 2. Dashboard lokal dan halaman edge HTTPS dapat memakai broker yang sama.

**Copy slide:** Laptop dan dua HP memakai Wi-Fi bersama. **Dashboard dilayani laptop pada LAN**; browser memakai HTTPS untuk sensor, sedangkan Termux membaca API Android. Semua menggunakan broker WSS dan Project ID yang sama.

**Visual/data lengkap:** Tabel “Opsi A: browser HTTPS, tanpa instalasi HP”; “Opsi B: Termux + Python Android”; “Dashboard laptop: HTTP LAN”; “Broker cloud: WSS”.

**Highlight:** “Server dashboard pada LAN”. **Sumber/catatan:** S1–S2, S6; HTTP IP laptop bukan secure context sensor bagi HP lain.

## Slide 3 · Sensor

**Headline:** Accelerometer dan gyroscope menyediakan dua sumber sensor nyata, sedangkan lokasi memberi konteks tambahan pada pengamatan.

**Tujuan/penghubung:** Menjelaskan sumber, unit, dan bukti sensor sebelum perhitungan.

**Layout:** Tabel sensor besar, dua anotasi ketersediaan/izin di bawahnya.

### 1. Dua jenis sensor harus benar-benar tersedia pada kedua HP.

**Copy slide:** Accelerometer membaca percepatan; gyroscope membaca laju putaran. **Nilai valid dan respons saat HP digerakkan menjadi bukti**, bukan sekadar keberadaan tombol atau keluaran API kosong.

**Visual/data lengkap:**

| Sensor        | Data masukan                         | Unit awal     | Hasil olahan                        |
| ------------- | ------------------------------------ | ------------- | ----------------------------------- |
| Accelerometer | x, y, z                              | m/s²          | RMS percepatan                      |
| Gyroscope | Browser: rotationRate; Termux: tiga sumbu gyro | Browser: derajat/detik; Termux: rad/detik | RMS laju putar dan total rotasi rad |

**Highlight:** Kolom bukti hasil olahan. **Sumber/catatan:** S2, S4, S6; `null` berarti tidak tersedia, bukan diam.

### 2. Lokasi membantu memetakan pengamatan tanpa menjamin sumber GPS fisik.

**Copy slide:** Geolocation memberi koordinat dan estimasi akurasi setelah izin pengguna. **Sumbernya dapat berupa GPS atau estimasi lain**, sehingga lokasi menjadi konteks tambahan dan tidak menggantikan gyroscope dalam bukti dua sensor.

**Visual/data lengkap:** Dua kartu “Lokasi valid: titik + akurasi + waktu”; “Lokasi tidak tersedia: tampilkan tabel, tanpa titik buatan”.

**Highlight:** “Akurasi + waktu”. **Sumber/catatan:** S6; ketelitian indoor belum diuji pada HP kelompok.

## Slide 4 · Processing

**Headline:** RMS percepatan dan integrasi rotasi mengolah gerakan, sementara statistik probe merangkum respons koneksi aplikasi melalui broker.

**Tujuan/penghubung:** Menunjukkan lebih dari dua pengolahan dengan rumus dan denominasi jelas.

**Layout:** Tiga modul ringkas; formula sensor di kiri/tengah, contoh statistik di kanan. Detail mode percepatan masuk appendix.

### 1. RMS merangkum besar percepatan dari sampel dalam window.

**Copy slide:** Browser memakai percepatan linear atau residual gravitasi; Termux memakai residual magnitude gravitasi. **Mode perhitungan ikut ditampilkan**, sehingga perbedaan sumber tidak tersembunyi saat hasil dibandingkan.

**Visual/data lengkap:** “Linear: RMS = akar(mean(ax² + ay² + az²))”; “Fallback: residual = magnitude − 9,80665; RMS = akar(mean(residual²))”.

**Highlight:** `accel_mode`. **Sumber/catatan:** S4; metode fallback berbeda dari pengukuran linear langsung. Untuk perbandingan awal, gunakan sumber/mode yang sama.

### 2. Integrasi laju putar menghasilkan akumulasi rotasi dalam radian.

**Copy slide:** Browser mengonversi derajat/detik ke radian/detik; **Termux sudah menerima radian/detik**. Keduanya mengintegrasikan besar laju putar. Termux memakai waktu kedatangan keluaran API sebagai pendekatan waktu sampel.

**Visual/data lengkap:** “omega = akar(wx² + wy² + wz²)”; “w_rad = w_derajat × π/180”; “rotasi = jumlah((omega_sebelumnya + omega_sekarang)/2 × Δt)”.

**Highlight:** “Browser × π/180; Termux tanpa konversi kedua”. **Sumber/catatan:** S4, S6; integrasi Termux memakai snapshot/waktu kedatangan API dan belum diuji akurasi hardware. Hasil bukan arah kompas atau rotasi bersih bertanda; jeda event >0,5 detik tidak diintegrasikan.

### 3. Keberhasilan probe memberi konteks pada rata-rata latensi.

**Copy slide:** Window memuat hingga sepuluh percobaan selesai. **Mean hanya memakai probe berhasil**, sehingga success% dan timeout harus ikut dibaca. Kegagalan tidak diganti angka latensi buatan.

**Visual/data lengkap, ilustrasi matematika:**

| Percobaan |                                                  Hasil |
| --------- | -----------------------------------------------------: |
| 1         |                                                 100 ms |
| 2         |                                                 120 ms |
| 3         |                                                 140 ms |
| 4         |                                                Timeout |
| Ringkasan | Mean 120 ms; std populasi 16,33 ms; berhasil 3/4 = 75% |

**Highlight:** “3/4 = 75%”. **Sumber/catatan:** Angka ilustratif, bukan lapangan; mean tidak memasukkan timeout sebagai 5.000 ms.

## Slide 5 · Komunikasi dua arah

**Headline:** Probe dan perintah memakai identitas pesan yang diperiksa, sehingga respons perangkat dapat ditelusuri tanpa menebak dari tampilan.

**Tujuan/penghubung:** Menjelaskan mekanisme komunikasi sebelum menampilkan dashboard.

**Layout:** Dua tabel alur; kiri probe, kanan command/ACK. Hindari screenshot JSON yang terlalu kecil.

### 1. Echo dengan nonce yang sama mengakhiri satu pengukuran roundtrip.

**Copy slide:** Edge menunggu subscription aktif, mengirim satu probe, lalu mencocokkan echo. **Hanya satu probe berlangsung pada satu waktu**, dengan timeout lima detik agar percobaan dapat berakhir sebagai berhasil atau gagal.

**Visual/data lengkap:** Urutan “Subscribe dikonfirmasi → nonce dikirim → broker meneruskan → nonce cocok → latency”; cabang “tidak kembali ≤5 s → timeout”.

**Highlight:** “Nonce cocok”. **Sumber/catatan:** S4; waktu ini bukan perjalanan HP A ke HP B.

### 2. ACK mengonfirmasi penerimaan perintah, sedangkan telemetry menunjukkan hasil sesudahnya.

**Copy slide:** Operator memilih perangkat dan sesi tujuan. **Command ID menghubungkan perintah dengan ACK**, lalu telemetry berikutnya menunjukkan hasil pengukuran. Sesi lama dan perintah kedaluwarsa tidak boleh mengontrol sesi baru.

**Visual/data lengkap:** Tabel “sample_now: minta probe/sampel berikutnya”; “set_interval: ubah 2–60 detik”; “ACK: diterima/ditolak”; “telemetry: sensor dan probe aktual”. Catatan: “TTL maksimum 30 detik; target_boot_id cocok”.

**Highlight:** “ACK ≠ jaminan sensor berhasil”. **Sumber/catatan:** S4; broker publik tetap membutuhkan kehati-hatian karena ID bukan autentikasi.

## Slide 6 · Dashboard

**Headline:** Dashboard memisahkan data riil, contoh, dan data tidak segar agar titik pengamatan tidak dibaca sebagai cakupan radio.

**Tujuan/penghubung:** Menunjukkan bagaimana UI membantu membaca hasil sebelum uji lapangan.

**Layout:** Screenshot dashboard versi final dua pertiga slide; dua anotasi dan satu catatan sumber di kanan. Screenshot demo wajib diberi label simulasi.

### 1. Tampilan awal menunggu perangkat dan contoh hanya muncul ketika dipilih.

**Copy slide:** Dashboard tidak langsung menganggap data contoh sebagai hasil pengamatan. **Sumber, waktu pembaruan, dan status probe ditampilkan**, sehingga operator dapat membedakan pengukuran riil, simulasi, atau data yang sudah tidak segar.

**Visual/data lengkap:** Anotasi screenshot: “Sumber browser/Termux”, “Waktu pembaruan”, “Probe terbaru”, “Sensor tersedia”. Bila memakai contoh, ganti label dengan “SIMULASI, BUKAN HASIL LAPANGAN”.

**Highlight:** Sumber data. **Sumber/catatan:** S4; screenshot UI tidak membuktikan akurasi hardware.

### 2. Warna grid hanya merangkum sampel yang memiliki konteks lokasi.

**Copy slide:** Titik dapat dikelompokkan dalam grid lokasi sekitar 25 meter. **Grid tidak menginterpolasi cakupan radio**; area tanpa sampel tetap belum diukur. Periksa akurasi lokasi sebelum membandingkan titik berdekatan.

**Visual/data lengkap:** Dua aturan “Grid berisi sampel: ringkasan pengamatan”; “Area tanpa sampel: belum diukur”. Tampilkan atribusi peta bila basemap digunakan.

**Highlight:** “Belum diukur”. **Sumber/catatan:** S4; grid 25 meter bukan klaim GPS akurat 25 meter.

## Slide 7 · Pengujian

**Headline:** Bukti dua HP harus mencakup sensor, probe, perintah, dan kegagalan sebelum kelompok menyatakan demo berhasil.

**Tujuan/penghubung:** Mengisi hasil aktual tanpa mencampur tes software dengan lapangan.

**Layout:** Tabel hasil ringkas di kiri; foto dua HP dan log perintah di kanan. Isi nilai hanya sesudah pengujian.

### 1. Uji software dan uji hardware membuktikan hal yang berbeda.

**Copy slide:** Tes otomatis memeriksa perhitungan dan alur dengan input terkendali. **Dua HP nyata memeriksa sensor, izin, dan koneksi**, sehingga kelulusan tes kode tidak menggantikan video pengujian perangkat.

**Visual/data lengkap:**

| Skenario hardware             | Hasil aktual awal | Bukti yang dilengkapi               |
| ----------------------------- | ----------------- | ----------------------------------- |
| Dua sensor pada dua HP        | Belum diuji       | Model/browser, video gerak/putar    |
| Dua edge dan probe cloud      | Belum diuji       | Dua ID, CSV/log                     |
| Command dan ACK               | Belum diuji       | Command ID, target sesi, telemetry  |
| Tab tersembunyi/koneksi putus | Belum diuji       | Status jeda/offline dan mulai ulang |

**Highlight:** Kolom hasil aktual. **Sumber/catatan:** S5; isi hasil software hanya dari VALIDATION.md akhir.

### 2. Perbandingan titik memerlukan durasi, broker, dan prosedur yang sama.

**Copy slide:** HP diamati berdampingan lalu ditempatkan pada dua titik dan ditukar posisinya. **Timeout dan akurasi lokasi ikut dicatat**, sehingga perbedaan perangkat atau kondisi broker tidak langsung dianggap akibat titik pengukuran.

**Visual/data lengkap:** Tabel kosong “Titik / HP / durasi / probe selesai / berhasil / timeout / mean ms / std ms / akurasi m”. Sel data bertuliskan “belum tersedia”, bukan nol.

**Highlight:** “Probe selesai” sebagai denominator. **Sumber/catatan:** Rancangan uji S5; bukan bukti hubungan sebab-akibat.

## Slide 8 · Penutup

**Headline:** Kode, hasil pengamatan, dan video yang dapat diulang menjadi dasar penilaian SigHeat serta perluasan titik pengujian.

**Tujuan:** Merangkum implementasi, bukti yang tersedia, dan tindakan berikutnya tanpa klaim kemenangan atau peningkatan yang belum diukur.

**Layout:** Tiga blok keputusan dan footer tautan final.

| Blok         | Copy siap pakai                                                                            | Gate bukti                                              |
| ------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Implementasi | Dua HP memakai opsi browser atau Termux, membaca sensor, dan mengirim hasil olahan melalui MQTT dua arah.         | Kode versi final dan demonstrasi                        |
| Pembuktian   | Keberhasilan dilaporkan sesuai hasil sensor, probe, dan perintah yang benar-benar direkam. | Lembar hasil, CSV/log, video                            |
| Pengembangan | Perluas titik setelah dua HP stabil; gunakan broker dengan ACL dan evaluasi mutu lokasi.   | Prosedur konsisten dan data cukup sebelum klaim wilayah |

**Highlight:** “Keberhasilan sesuai bukti”. **Sumber/catatan:** S1, S4, S5.

Footer: link repository kelompok yang sudah memuat revisi, link situs setelah deployment selesai, dan link video yang dapat dibuka. Untuk repository kelompok: `https://github.com/faadd/SigHeat`. Situs setelah penerbitan: `https://faadd.github.io/SigHeat/`. Verifikasi versi yang terbuka sebelum presentasi.

## Appendix

1. Matriks rubrik lengkap dan pembagian kontribusi.
2. Rumus serta contoh hitung manual.
3. Payload telemetry/command/ACK dan ACL tanpa password.
4. Model/OS/browser atau Termux, ketersediaan sensor, izin, dan konteks pengamatan.
5. Hasil gagal, timeout, jeda tab, serta keterbatasan lokasi.
6. Referensi teknis dan laporan tes software.

## Gap sebelum pengumpulan

Hasil dua HP, ketersediaan gyroscope, koneksi broker kelompok, dan dashboard LAN perlu diisi dari pengujian nyata. Keunikan ide pada sheet kelas dan tanggal pengumpulan perlu diperiksa kelompok. Struktur dua opsi mengadaptasi README contoh yang dilampirkan; fitur anti-pencurian dan Sensor Playground umum tidak menjadi fitur SigHeat.
