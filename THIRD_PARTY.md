# Aset dan dependensi

- Leaflet 1.9.4: `assets/vendor/leaflet.js`, CSS, dan gambar pendukung. Lisensi BSD-2-Clause disertakan pada `assets/vendor/leaflet-LICENSE.txt`. Sumber: https://leafletjs.com/ dan paket resmi https://unpkg.com/leaflet@1.9.4/.
- Eclipse Paho JavaScript 1.1.0: `assets/vendor/paho-mqtt.min.js`. Header lisensi dipertahankan; teks EPL-1.0 ada pada `assets/vendor/paho-EPL-1.0.txt`. Sumber: https://github.com/eclipse-paho/paho.mqtt.javascript.
- Versi browser tidak membutuhkan paket Python di HP. `server.py` opsional pada laptop memakai pustaka standar Python saja.
- Opsi Termux memasang `paho-mqtt==2.1.0` dan `python-dotenv==1.1.1` melalui `requirements.txt`; paket tersebut tidak disalin ke ZIP. Sumber proyek: https://github.com/eclipse-paho/paho.mqtt.python dan https://github.com/theskumar/python-dotenv. Termux dan Termux:API dipasang terpisah dari sumber resmi: https://github.com/termux/termux-app dan https://github.com/termux/termux-api.
- Peta dasar opsional: OpenStreetMap pada `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. Atribusi tampil saat peta aktif, referrer tidak diblokir, dan aplikasi tidak menambahkan unduhan tile massal/prefetch/offline. Tile standar bersifat best-effort dan tunduk pada kebijakan penggunaan: https://operations.osmfoundation.org/policies/tiles/ (diperiksa 4 November 2026).
- Mode Heatmap memakai kode aplikasi lokal `assets/heatmap.js` dan `assets/heatmap-layer.js`, Canvas browser, serta Leaflet yang sudah tersedia. Tidak ada plugin heatmap eksternal, API key, langganan, atau dependensi berbayar tambahan. Warna memakai lima jangkar dari keluarga viridis; legenda dan batas interpretasi dijelaskan di `docs/HEATMAP.md`.

Kode aplikasi merupakan revisi proyek SigHeat yang diberikan pengguna. Dokumen ini tidak menetapkan lisensi baru untuk kode milik kelompok.
