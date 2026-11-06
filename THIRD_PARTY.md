# Aset dan dependensi

## Layanan pusat dan pengujian v5

Versi berikut dipasang melalui npm dan dicatat pada `package.json` serta `package-lock.json`. Metadata dan teks lisensi dependensi langsung diperiksa dari paket yang terpasang saat penyiapan v5.

| Paket | Versi | Pemakaian | Lisensi dan sumber |
|---|---|---|---|
| MQTT.js (`mqtt`) | 5.16.1 | Klien MQTT layanan pusat | MIT; [MQTT.js](https://github.com/mqttjs/MQTT.js); teks paket `node_modules/mqtt/LICENSE.md` |
| Aedes (`aedes`) | 1.2.0 | Broker lokal untuk tes integrasi; dependensi pengembangan | MIT; [Aedes](https://github.com/moscajs/aedes); teks paket `node_modules/aedes/LICENSE` |
| jsdom (`jsdom`) | 26.1.0 | Pengujian DOM dashboard; dependensi pengembangan | MIT; [jsdom](https://github.com/jsdom/jsdom); teks paket `node_modules/jsdom/LICENSE.txt` |

Layanan pusat memerlukan **Node.js 24 atau lebih baru** dan menggunakan modul bawaan `node:sqlite`. SQLite tidak dipasang melalui paket npm native tambahan pada proyek ini. Node.js/SQLite mengikuti lisensi serta pemberitahuan distribusi runtimenya; lihat [Node.js](https://github.com/nodejs/node), [dokumentasi node:sqlite](https://nodejs.org/api/sqlite.html), dan [SQLite](https://www.sqlite.org/copyright.html).

`package-lock.json` merekam versi, sumber unduhan, dan integritas pohon dependensi yang digunakan `npm ci`, termasuk dependensi transitif. Tabel di atas hanya daftar dependensi langsung; lisensi transitif mengikuti masing-masing paket. `node_modules/` tidak disertakan pada source ZIP dan tidak di-commit. Instalasi npm menyertakan berkas lisensi paketnya. `npm ci --omit=dev` dapat dipakai untuk pemasangan layanan produksi; tes memerlukan dependensi pengembangan.

Aedes dan jsdom dipakai untuk pengujian perangkat lunak. Tes jsdom bukan pengujian visual browser/HP fisik, dan broker Aedes lokal bukan bukti bahwa broker eksternal kelompok telah diuji.

Grafik evaluasi v5 dibuat dengan SVG dan JavaScript aplikasi. Tidak ada layanan AI berbayar atau pustaka grafik tambahan untuk menggambar bukti MAE.

## Aset browser, pengukur, dan peta yang dipertahankan

- Leaflet 1.9.4: `assets/vendor/leaflet.js`, CSS, dan gambar pendukung. Lisensi BSD-2-Clause disertakan pada `assets/vendor/leaflet-LICENSE.txt`. Sumber: https://leafletjs.com/ dan paket resmi https://unpkg.com/leaflet@1.9.4/.
- Eclipse Paho JavaScript 1.1.0: `assets/vendor/paho-mqtt.min.js`. Header lisensi dipertahankan; teks EPL-1.0 ada pada `assets/vendor/paho-EPL-1.0.txt`. Sumber: https://github.com/eclipse-paho/paho.mqtt.javascript.
- Versi browser tidak membutuhkan paket Python di HP. `server.py` opsional pada laptop memakai pustaka standar Python saja.
- Opsi Termux memasang `paho-mqtt==2.1.0` dan `python-dotenv==1.1.1` melalui `requirements.txt`; paket tersebut tidak disalin ke ZIP. Sumber proyek: https://github.com/eclipse-paho/paho.mqtt.python dan https://github.com/theskumar/python-dotenv. Termux dan Termux:API dipasang terpisah dari sumber resmi: https://github.com/termux/termux-app dan https://github.com/termux/termux-api.
- Peta dasar opsional: OpenStreetMap pada `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. Atribusi tampil saat peta aktif, referrer tidak diblokir, dan aplikasi tidak menambahkan unduhan tile massal/prefetch/offline. Tile standar bersifat best-effort dan tunduk pada kebijakan penggunaan: https://operations.osmfoundation.org/policies/tiles/ (diperiksa 4 November 2026).
- Mode Heatmap memakai kode aplikasi lokal `assets/heatmap.js` dan `assets/heatmap-layer.js`, Canvas browser, serta Leaflet yang sudah tersedia. Tidak ada plugin heatmap eksternal, API key, langganan, atau dependensi berbayar tambahan. Warna memakai lima jangkar dari keluarga viridis; legenda dan batas interpretasi dijelaskan di `docs/HEATMAP.md`.

Kode aplikasi merupakan revisi proyek SigHeat yang diberikan pengguna. Dokumen ini tidak menetapkan lisensi baru untuk kode milik kelompok.
