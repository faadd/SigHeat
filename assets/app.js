/* SigHeat Browser/Termux interface. Demo samples stay local; credentials are never persisted. */
(function () {
  "use strict";
  const C = window.SigHeatCore;
  const $ = (id) => document.getElementById(id);
  const dashboard = document.body.dataset.page === "dashboard";
  const state = {
    demo: false,
    connected: false,
    connecting: false,
    client: null,
    generation: 0,
    project: "",
    broker: "",
    selected: null,
    devices: new Map(),
    statuses: new Map(),
    points: [],
    logs: [],
    pending: new Map(),
    map: null,
    markers: null,
    mapMode: "points",
    mapFitted: false,
    edge: null,
    edgeGeneration: 0,
    csv: "",
    csvName: "",
    connectWatchdog: null,
    sourceFilter: "all",
    csvCount: 0,
  };
  const labels = {
      good: "Responsif",
      fair: "Cukup",
      poor: "Perlu dicek",
      unknown: "Belum terbaca",
    },
    colors = {
      good: "#28765a",
      fair: "#b98736",
      poor: "#bb6051",
      unknown: "#7c8b7d",
    };
  const names = { "hp-a": "HP Area A", "hp-b": "HP Area B" };
  const finite = (v, min = -Infinity, max = Infinity) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  const fmt = (v, n = 0) =>
    finite(v)
      ? v.toLocaleString("id-ID", {
          minimumFractionDigits: n,
          maximumFractionDigits: n,
        })
      : "–";
  const name = (id) => names[id] || id;
  const text = (id, v) => {
    if ($(id)) $(id).textContent = v;
  };
  function el(tag, content, cls) {
    const node = document.createElement(tag);
    if (content !== undefined) node.textContent = content;
    if (cls) node.className = cls;
    return node;
  }
  let toastTimer;
  function toast(message) {
    if (!$("toast")) return;
    text("toast", message);
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($("toast").hidden = true), 4500);
  }
  function log(message) {
    state.logs.unshift({
      at: Date.now(),
      message: String(message).slice(0, 600),
    });
    state.logs = state.logs.slice(0, 100);
    renderLogs();
  }
  function renderLogs() {
    const list = $("activity-log");
    if (!list) return;
    list.replaceChildren();
    if (!state.logs.length) {
      list.append(el("li", "Belum ada aktivitas.", "muted"));
      return;
    }
    state.logs.forEach((entry) => {
      const li = el("li");
      li.append(
        el("span", new Date(entry.at).toLocaleTimeString("id-ID"), "log-time"),
        el("span", entry.message),
      );
      list.append(li);
    });
  }
  function brokerUrl(raw) {
    try {
      const u = new URL(raw);
      return u.protocol === "wss:" &&
        !u.username &&
        !u.password &&
        !u.hash &&
        !u.search
        ? u
        : null;
    } catch (_) {
      return null;
    }
  }
  function sameBroker(a, b) {
    const x = brokerUrl(a),
      y = brokerUrl(b);
    return !!x && !!y && x.href === y.href;
  }
  function sourceLabel(source) {
    return source === "termux"
      ? "Termux + Python"
      : source === "browser"
        ? "Browser"
        : "Contoh lokal";
  }
  function visiblePoints() {
    return C.filterBySource(
      state.points,
      state.demo ? "all" : state.sourceFilter,
    );
  }
  function visibleDevices() {
    return C.filterBySource(
      [...state.devices.values()],
      state.demo ? "all" : state.sourceFilter,
    );
  }
  function mixedSources() {
    return new Set(visiblePoints().map((p) => p.source)).size > 1;
  }
  function qualified(p) {
    return {
      ...p,
      quality:
        p.connection_quality ||
        (p.probe_ok === false
          ? "poor"
          : C.quality(p.latency_mean_ms, p.success_pct)),
      received_at_ms: Date.now(),
    };
  }
  function stale(p) {
    if (state.demo) return false;
    const status = state.statuses.get(p.device_id);
    return (
      !state.connected ||
      Date.now() - p.sent_at_ms > Math.max(30000, (p.interval_s || 5) * 3000) ||
      (status?.boot_id === p.boot_id &&
        status.online === false &&
        status.received_at_ms >= p.received_at_ms)
    );
  }
  function metric(id, value, unit) {
    $(id)?.replaceChildren(
      document.createTextNode(String(value)),
      el("span", unit),
    );
  }
  function clearPending() {
    state.pending.forEach((p) => clearTimeout(p.timer));
    state.pending.clear();
  }
  function clearData() {
    state.devices.clear();
    state.statuses.clear();
    state.points = [];
    state.selected = null;
    state.sourceFilter = "all";
    state.mapFitted = false;
    clearPending();
    text("command-status", "Belum ada perintah pada sesi ini.");
  }
  function render() {
    if (!dashboard) return;
    const selected = state.devices.get(state.selected);
    if (
      !selected ||
      (!state.demo &&
        state.sourceFilter !== "all" &&
        selected.source !== state.sourceFilter)
    )
      state.selected = visibleDevices()[0]?.device_id || null;
    if (mixedSources() && state.mapMode === "grid") state.mapMode = "points";
    renderMode();
    renderMetrics();
    renderDevices();
    renderDetail();
    renderMap();
    renderInsight();
  }
  function renderMode() {
    if ($("source-filter")) {
      $("source-filter").disabled = state.demo;
      $("source-filter").value = state.demo ? "all" : state.sourceFilter;
      if ($("source-filter").options?.[0])
        $("source-filter").options[0].textContent = state.demo
          ? "Semua perangkat contoh"
          : "Semua sumber";
    }
    text(
      "source-filter-note",
      state.demo
        ? "Contoh lokal tidak berasal dari Browser atau Termux."
        : mixedSources()
          ? "Rerata dan grid gabungan dinonaktifkan. Pilih satu sumber untuk membandingkan hasil."
          : "Bandingkan perangkat dengan opsi, broker, dan kondisi yang sama.",
    );
    if ($("map-grid")) {
      $("map-grid").disabled = mixedSources();
      $("map-grid").title = mixedSources()
        ? "Pilih satu sumber sebelum melihat grid."
        : "Grid sampel terukur per sumber.";
    }
    text(
      "mode-chip",
      state.demo
        ? "CONTOH LOKAL"
        : state.connecting
          ? "MENGHUBUNGKAN"
          : state.connected
            ? "BROKER TERHUBUNG"
            : "BELUM TERHUBUNG",
    );
    $("mode-chip").className =
      "chip " + (state.demo ? "amber" : state.connected ? "" : "grey");
    text(
      "mode-text",
      state.demo
        ? "Semua lokasi, nilai, sensor, dan respons perintah di mode ini merupakan contoh lokal."
        : state.connected
          ? "Menerima pengukuran Browser dan Termux + Python pada broker serta proyek yang sama."
          : "Hubungkan broker untuk menerima data kedua HP.",
    );
    text(
      "mode-action",
      state.demo
        ? "Keluar dari contoh"
        : state.connected
          ? "Putuskan"
          : "Lihat contoh lokal",
    );
    text(
      "connection-status",
      state.connected
        ? "MQTT terhubung"
        : state.connecting
          ? "Menghubungkan…"
          : "MQTT belum terhubung",
    );
    $("status-dot")?.classList.toggle("online", state.connected);
    $("mode-strip")?.classList.toggle("live", state.connected);
    document
      .querySelectorAll(".project-label")
      .forEach((n) => (n.textContent = state.project || "Belum terhubung"));
    text(
      "sidebar-source",
      state.demo
        ? "Contoh lokal, tanpa broker"
        : state.connected
          ? "Browser / Termux + Python"
          : "Belum menerima data",
    );
    text(
      "footer-note",
      state.demo
        ? "Contoh lokal · Tidak ada pesan ke broker"
        : state.connected
          ? "MQTT over TLS · Data sesi ini"
          : "Belum terhubung · Data lama ditandai tidak aktif",
    );
    text(
      "map-overlay",
      state.demo
        ? "CONTOH LOKAL · Semua lokasi dan nilai adalah ilustrasi"
        : "Hanya koordinat yang dibagikan perangkat",
    );
    text(
      "map-subtitle",
      state.demo
        ? "Contoh lokasi sekitar Tembalang, Semarang"
        : "Aktifkan berbagi lokasi pada kontributor untuk menampilkan titik",
    );
  }
  function renderMetrics() {
    const devices = visibleDevices(),
      samples = visiblePoints(),
      located = samples.filter(
        (p) => finite(p.latitude) && finite(p.longitude),
      ),
      valid = samples.filter((p) => p.probe_ok && finite(p.latency_ms)),
      poor = samples.filter((p) => p.quality === "poor");
    metric("metric-devices", devices.length, "perangkat");
    metric("metric-points", located.length, "sampel");
    metric(
      "metric-rssi",
      valid.length && !mixedSources()
        ? fmt(valid.reduce((s, p) => s + p.latency_ms, 0) / valid.length)
        : "–",
      "ms",
    );
    metric("metric-weak", poor.length, "sampel");
    text(
      "metric-devices-note",
      state.demo
        ? "2 perangkat contoh, tanpa sensor aktif"
        : `${devices.filter((p) => !stale(p)).length} perangkat mengirim data terkini`,
    );
    text("nav-device-count", state.devices.size);
    text(
      "metric-rssi-note",
      mixedSources()
        ? "Pilih satu sumber untuk rerata."
        : "Putar balik pesan aplikasi via MQTT",
    );
  }
  function renderDevices() {
    for (const [id, full] of [
      ["device-table", false],
      ["all-device-table", true],
    ]) {
      const body = $(id);
      body.replaceChildren();
      const devices = visibleDevices();
      if (!devices.length) {
        const row = el("tr"),
          cell = el(
            "td",
            "Belum ada data. Buka kontributor pada kedua HP, lalu hubungkan broker.",
            "muted",
          );
        cell.colSpan = full ? 6 : 4;
        row.append(cell);
        body.append(row);
        continue;
      }
      devices.forEach((p) => {
        const row = el("tr", undefined, "table-row");
        row.tabIndex = 0;
        row.setAttribute("aria-label", "Pilih " + name(p.device_id));
        row.setAttribute(
          "aria-selected",
          String(state.selected === p.device_id),
        );
        row.addEventListener("click", () => selectDevice(p.device_id));
        row.addEventListener("keydown", (e) => {
          if (["Enter", " "].includes(e.key)) {
            e.preventDefault();
            selectDevice(p.device_id);
          }
        });
        const cell = el("td"),
          wrap = el("div", undefined, "device-cell"),
          label = el("div");
        label.append(
          el("strong", name(p.device_id)),
          el("span", p.device_id + " · " + sourceLabel(p.source), "data-sub"),
        );
        wrap.append(el("span", undefined, "device-icon"), label);
        cell.append(wrap);
        row.append(cell, el("td", fmt(p.latency_mean_ms) + " ms", "mono"));
        if (full) {
          row.append(
            el("td", fmt(p.success_pct) + " %", "mono"),
            el(
              "td",
              p.accel_available
                ? fmt(p.accel_rms, 2) + " m/s²"
                : "Tidak tersedia",
              "mono",
            ),
            el(
              "td",
              p.gyro_available
                ? fmt(p.gyro_rms_rad_s, 2) + " rad/s"
                : "Tidak tersedia",
              "mono",
            ),
          );
        } else {
          const q = el("td");
          q.append(
            el(
              "span",
              labels[p.quality],
              "chip " +
                (p.quality === "poor"
                  ? "red"
                  : p.quality === "fair"
                    ? "amber"
                    : p.quality === "unknown"
                      ? "grey"
                      : ""),
            ),
          );
          row.append(q);
        }
        const status = el("td");
        status.append(
          el(
            "span",
            state.demo ? "Contoh" : stale(p) ? "Tidak aktif" : "Aktif",
            "chip " + (state.demo ? "grey" : stale(p) ? "amber" : ""),
          ),
        );
        row.append(status);
        body.append(row);
      });
    }
    text(
      "selected-device-label",
      state.selected
        ? "Perangkat dipilih: " + state.selected
        : "Belum ada perangkat dipilih.",
    );
    $("set-interval").disabled =
      !state.selected || (!state.demo && !state.connected);
  }
  function selectDevice(id) {
    state.selected = id;
    renderDevices();
    renderDetail();
    renderMap();
  }
  function renderDetail() {
    const p = state.devices.get(state.selected);
    text("detail-name", p ? name(p.device_id) : "Pilih perangkat");
    text(
      "detail-status",
      !p
        ? "Menunggu"
        : state.demo
          ? "Contoh"
          : stale(p)
            ? "Tidak aktif"
            : "Aktif",
    );
    $("detail-status").className = "chip " + (!p || stale(p) ? "grey" : "");
    $("detail-rssi").replaceChildren(
      document.createTextNode(fmt(p?.latency_mean_ms) + " "),
      el("small", "ms"),
    );
    text(
      "detail-signal",
      p
        ? "Latensi aplikasi MQTT · " + labels[p.quality]
        : "Belum ada sampel dari perangkat",
    );
    text("detail-source", p ? sourceLabel(p.source) : "–");
    text("detail-std", fmt(p?.latency_std_ms, 1) + " ms");
    text("detail-success", fmt(p?.success_pct) + " %");
    text(
      "detail-motion",
      p?.accel_available ? fmt(p.accel_rms, 2) + " m/s²" : "Tidak tersedia",
    );
    text(
      "detail-gyro",
      p?.gyro_available
        ? fmt(p.gyro_rms_rad_s, 2) + " rad/s"
        : "Tidak tersedia",
    );
    text(
      "detail-gps",
      finite(p?.accuracy_m)
        ? "± " + fmt(p.accuracy_m) + " m"
        : "Tidak dibagikan",
    );
    text(
      "detail-time",
      !p
        ? "–"
        : state.demo
          ? "Contoh lokal"
          : new Date(p.sent_at_ms).toLocaleTimeString("id-ID"),
    );
    $("sample-now").disabled = !p || (!state.demo && stale(p));
    $("sample-now").textContent = state.demo
      ? "Uji contoh permintaan"
      : "Minta sampel sekarang";
    const chart = $("detail-chart");
    chart.replaceChildren();
    const points = visiblePoints()
      .filter(
        (x) =>
          x.device_id === state.selected &&
          x.source === p?.source &&
          finite(x.latency_mean_ms),
      )
      .slice(-18);
    if (points.length > 1) {
      const min = 0,
        max = Math.max(...points.map((x) => x.latency_mean_ms)) * 1.2 || 1,
        poly = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "polyline",
        );
      poly.setAttribute(
        "points",
        points
          .map(
            (x, i) =>
              `${(i / (points.length - 1)) * 238 + 1},${49 - ((x.latency_mean_ms - min) / (max - min)) * 42}`,
          )
          .join(" "),
      );
      poly.setAttribute("fill", "none");
      poly.setAttribute("stroke", colors[p.quality]);
      poly.setAttribute("stroke-width", "2");
      chart.append(poly);
      chart.setAttribute(
        "aria-label",
        `${points.length} sampel latensi, ${fmt(Math.min(...points.map((x) => x.latency_mean_ms)))} hingga ${fmt(max / 1.2)} ms`,
      );
    }
  }
  function renderInsight() {
    const valid = visiblePoints(),
      poor = valid.filter((x) => x.quality === "poor");
    text(
      "insight-title",
      valid.length
        ? `${poor.length} dari ${valid.length} sampel perlu ditinjau.`
        : "Mulai pengukuran bersama.",
    );
    text(
      "insight-copy",
      state.demo
        ? "Contoh ini menunjukkan latensi lebih tinggi pada HP Area B. Ini bukan hasil sensor atau kondisi jaringan nyata."
        : valid.length
          ? "Ulangi saat HP diam, dengan opsi Browser atau Termux yang sama. Perbedaan runtime dapat memengaruhi latensi aplikasi."
          : "Buka kontributor pada dua HP dengan ID berbeda. Gunakan broker dan Project ID yang sama.",
    );
  }
  function changeView(view) {
    document
      .querySelectorAll(".view")
      .forEach((n) => (n.hidden = n.id !== "view-" + view));
    document
      .querySelectorAll("[data-view]")
      .forEach((n) => n.classList.toggle("active", n.dataset.view === view));
    const labels = {
      map: [
        "Peta koneksi",
        "Pahami koneksi di setiap titik.",
        "Bandingkan latensi aplikasi dan gerakan perangkat pada titik pengukuran berbeda.",
      ],
      devices: [
        "Perangkat",
        "Kelola perangkat pengukuran.",
        "Browser dan Termux + Python mengirim data serta menerima perintah melalui MQTT.",
      ],
      activity: [
        "Aktivitas",
        "Ikuti percakapan perangkat.",
        "Periksa perintah, masa berlaku, dan konfirmasi ACK.",
      ],
      guide: [
        "Panduan",
        "Siapkan pengukuran bersama.",
        "Dua HP, satu proyek, dan hasil yang dapat diperiksa.",
      ],
    };
    text("breadcrumb-current", labels[view][0]);
    text("page-title", labels[view][1]);
    text("page-subtitle", labels[view][2]);
    if (view === "map") setTimeout(() => state.map?.invalidateSize(), 50);
  }
  function initRoadMap() {
    if (!window.L) {
      state.mapMode = "points";
      toast(
        "Pustaka peta belum tersedia. Plot koordinat tetap dapat digunakan.",
      );
      return;
    }
    $("signal-map").replaceChildren();
    state.map = L.map("signal-map", { scrollWheelZoom: false }).setView(
      [-7.05, 110.44],
      15,
    );
    state.markers = L.layerGroup().addTo(state.map);
    let errors = 0;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
    })
      .addTo(state.map)
      .on("tileerror", () => {
        if (++errors >= 3 && state.map) {
          changeMapMode("points");
          toast("Peta dasar gagal dimuat. Plot koordinat tetap tersedia.");
        }
      });
  }
  function changeMapMode(mode) {
    if (state.map) {
      state.map.remove();
      state.map = null;
    }
    state.mapMode = mode;
    state.mapFitted = false;
    if (mode === "roads") initRoadMap();
    renderMap();
  }
  function renderMap() {
    const root = $("signal-map");
    if (!root) return;
    ["points", "grid", "roads"].forEach((mode) =>
      $("map-" + mode)?.classList.toggle("active", state.mapMode === mode),
    );
    text(
      "map-view-note",
      state.mapMode === "grid"
        ? "Grid terukur ±25 m · sel kosong belum diukur"
        : state.mapMode === "roads"
          ? "Peta OSM · pilih Titik jika peta gagal"
          : "Plot koordinat · tanpa peta dasar",
    );
    const points = visiblePoints().filter(
      (p) => finite(p.latitude) && finite(p.longitude),
    );
    if (state.map && state.mapMode === "roads") {
      state.markers.clearLayers();
      points.forEach((p) => {
        const marker = L.circleMarker([p.latitude, p.longitude], {
          radius: state.selected === p.device_id ? 7 : 5,
          color: "#fff",
          weight: 2,
          fillColor: colors[p.quality],
          fillOpacity: stale(p) ? 0.4 : 0.9,
        }).addTo(state.markers);
        const popup = el("div");
        popup.append(
          el("strong", name(p.device_id)),
          el("div", fmt(p.latency_mean_ms) + " ms · " + sourceLabel(p.source)),
          el("div", p.latitude.toFixed(5) + ", " + p.longitude.toFixed(5)),
        );
        marker.bindPopup(popup).on("click", () => selectDevice(p.device_id));
      });
      if (points.length && !state.mapFitted) {
        state.map.fitBounds(
          points.map((p) => [p.latitude, p.longitude]),
          { padding: [50, 50], maxZoom: 17 },
        );
        state.mapFitted = true;
      }
      return;
    }
    root.replaceChildren();
    const plane = el("div", undefined, "map-fallback");
    plane.append(
      el("span", "N ↑", "fallback-north"),
      el(
        "span",
        state.mapMode === "grid"
          ? "Rerata per sel ±25 m · tanpa interpolasi"
          : "Plot koordinat WGS84 · utara di atas",
        "fallback-caption",
      ),
    );
    root.append(plane);
    if (!points.length) {
      const empty = el("div", undefined, "empty");
      empty.style.paddingTop = "115px";
      empty.append(
        el("strong", "Belum ada titik pengukuran."),
        el(
          "p",
          "Hubungkan perangkat, lalu aktifkan berbagi lokasi untuk memetakan sampel.",
        ),
      );
      plane.append(empty);
      return;
    }
    const lat = points.map((p) => p.latitude),
      lon = points.map((p) => p.longitude),
      minLat = Math.min(...lat),
      maxLat = Math.max(...lat),
      minLon = Math.min(...lon),
      maxLon = Math.max(...lon),
      midLat = (minLat + maxLat) / 2,
      midLon = (minLon + maxLon) / 2,
      cos = Math.max(Math.cos((midLat * Math.PI) / 180), 0.01),
      ratio =
        Math.max(root.clientWidth, 300) / Math.max(root.clientHeight, 300),
      latSpan =
        Math.max(maxLat - minLat, ((maxLon - minLon) * cos) / ratio, 0.0012) *
        1.55,
      lonSpan = (latSpan * ratio) / cos;
    if (state.mapMode === "grid") {
      C.aggregateGrid(points, 25).forEach((cell) => {
        const quality =
            cell.quality || C.quality(cell.latency_mean_ms, cell.success_pct),
          button = el("button", undefined, "measured-cell"),
          w =
            ((cell.bounds
              ? cell.bounds.east - cell.bounds.west
              : 25 / 111320 / cos) /
              lonSpan) *
            100,
          h =
            ((cell.bounds
              ? cell.bounds.north - cell.bounds.south
              : 25 / 111320) /
              latSpan) *
            100;
        button.style.left =
          50 + ((cell.longitude - midLon) / lonSpan) * 100 - w / 2 + "%";
        button.style.top =
          50 - ((cell.latitude - midLat) / latSpan) * 100 - h / 2 + "%";
        button.style.width = w + "%";
        button.style.height = h + "%";
        button.style.background = colors[quality];
        button.title = `${fmt(cell.latency_mean_ms, 1)} ms · ${cell.count} sampel · ${sourceLabel(cell.source)} · sel ±25 m`;
        button.setAttribute("aria-label", button.title);
        if ((w * root.clientWidth) / 100 > 17)
          button.textContent = String(cell.count);
        button.addEventListener("click", () => toast(button.title));
        plane.append(button);
      });
      return;
    }
    points.forEach((p, i) => {
      const x = 50 + ((p.longitude - midLon) / lonSpan) * 100,
        y = 50 - ((p.latitude - midLat) / latSpan) * 100,
        button = el(
          "button",
          undefined,
          "fallback-point" +
            (state.selected === p.device_id ? " selected" : ""),
        );
      button.style.left = x + "%";
      button.style.top = y + "%";
      button.style.background = colors[p.quality];
      button.title = `${name(p.device_id)} · ${sourceLabel(p.source)} · ${fmt(p.latency_mean_ms)} ms · ${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`;
      button.setAttribute("aria-label", button.title);
      button.addEventListener("click", () => selectDevice(p.device_id));
      plane.append(button);
      if (!points.slice(i + 1).some((next) => next.device_id === p.device_id)) {
        const label = el(
          "span",
          name(p.device_id) +
            " · " +
            sourceLabel(p.source) +
            " · " +
            fmt(p.latency_mean_ms) +
            " ms",
          "fallback-label",
        );
        label.style.left = x + "%";
        label.style.top = `calc(${y}% - 13px)`;
        plane.append(label);
      }
    });
  }
  function disconnect(show = true) {
    clearTimeout(state.connectWatchdog);
    state.connectWatchdog = null;
    state.generation++;
    const client = state.client;
    state.client = null;
    state.connected = false;
    state.connecting = false;
    clearPending();
    try {
      if (client?.isConnected()) client.disconnect();
    } catch (_) {}
    if ($("connect-button")) {
      $("connect-button").disabled = false;
      text("connect-button", "Hubungkan");
    }
    if (show) {
      log("Koneksi diputus. Data sebelumnya ditandai tidak aktif.");
      render();
    }
  }
  function closeConnection() {
    if (state.connecting) disconnect(false);
    $("connection-dialog").close();
    $("broker-password").value = "";
    renderMode();
  }
  function connect(event) {
    event.preventDefault();
    const url = brokerUrl($("broker-url").value.trim()),
      project = $("project-id").value.trim(),
      P = window.Paho?.MQTT || window.Paho;
    if (!url || !C.validId(project)) {
      text(
        "connection-error",
        "Gunakan WSS yang valid dan Project ID berisi huruf, angka, garis bawah, atau tanda hubung.",
      );
      return;
    }
    if (!P?.Client) {
      text(
        "connection-error",
        "Pustaka MQTT belum tersedia. Periksa berkas aplikasi.",
      );
      return;
    }
    disconnect(false);
    clearData();
    state.demo = false;
    state.project = project;
    state.broker = url.href;
    state.connecting = true;
    render();
    const generation = state.generation;
    let client;
    try {
      client = new P.Client(
        url.hostname,
        Number(url.port) || 443,
        url.pathname || "/mqtt",
        "sh_dash_" + C.makeId(),
      );
    } catch (_) {
      state.connecting = false;
      text(
        "connection-error",
        "Koneksi broker gagal dibuat. Periksa alamat WSS.",
      );
      render();
      return;
    }
    state.client = client;
    text("connect-button", "Menghubungkan…");
    $("connect-button").disabled = true;
    text("connection-error", "");
    const current = () =>
      generation === state.generation && state.client === client;
    const fail = (message) => {
      if (!current()) return;
      disconnect(false);
      text("connection-error", message);
      log(message);
      render();
    };
    state.connectWatchdog = setTimeout(
      () =>
        fail(
          "Broker belum mengonfirmasi koneksi dan langganan dalam 15 detik. Silakan coba lagi.",
        ),
      15000,
    );
    client.onConnectionLost = () => {
      if (!current()) return;
      if (state.connecting) {
        fail("Koneksi terputus sebelum langganan siap. Silakan coba lagi.");
        return;
      }
      disconnect(false);
      log("Koneksi broker terputus. Hubungkan kembali melalui Atur koneksi.");
      render();
    };
    client.onMessageArrived = (message) => {
      if (current()) receive(message);
    };
    const options = {
      useSSL: true,
      cleanSession: true,
      mqttVersion: 4,
      keepAliveInterval: 30,
      timeout: 12,
      onSuccess: () => {
        if (!current()) {
          try {
            client.disconnect();
          } catch (_) {}
          return;
        }
        let subscribed = 0;
        for (const kind of ["telemetry", "status", "ack"]) {
          try {
            client.subscribe(`sigheat/${project}/edge/+/${kind}`, {
              qos: 1,
              timeout: 5,
              onSuccess: (response) => {
                if (!current()) return;
                const grants = response?.grantedQos || response?.grantedQoS;
                if (Array.isArray(grants) && grants.includes(128)) {
                  fail("Broker menolak izin langganan. Periksa ACL proyek.");
                  return;
                }
                if (++subscribed === 3) {
                  clearTimeout(state.connectWatchdog);
                  state.connectWatchdog = null;
                  state.connected = true;
                  state.connecting = false;
                  log(
                    "Broker terhubung dan langganan aktif. Menunggu perangkat proyek " +
                      project +
                      ".",
                  );
                  $("connection-dialog").close();
                  $("broker-password").value = "";
                  $("connect-button").disabled = false;
                  text("connect-button", "Hubungkan");
                  render();
                }
              },
              onFailure: () =>
                fail(
                  "Langganan gagal atau kedaluwarsa. Periksa izin baca topik proyek.",
                ),
            });
          } catch (_) {
            fail("Permintaan langganan gagal dikirim. Periksa koneksi broker.");
            break;
          }
        }
      },
      onFailure: () =>
        fail(
          "Koneksi gagal. Periksa alamat WSS, internet, dan kredensial broker.",
        ),
    };
    const username = $("broker-username").value,
      password = $("broker-password").value;
    if (username) options.userName = username;
    if (password) options.password = password;
    try {
      client.connect(options);
    } catch (_) {
      fail("Koneksi broker gagal dimulai.");
    }
  }
  function receive(message) {
    if (!state.connected || state.demo) return;
    let raw, topic;
    try {
      if (message.payloadBytes?.byteLength > 32768) return;
      const body = message.payloadString;
      if (typeof body !== "string" || body.length > 32768) return;
      topic = C.parseTopic(message.destinationName, state.project);
      if (!topic) return;
      raw = JSON.parse(body);
    } catch (_) {
      return;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    if (topic.kind === "telemetry") {
      const value = C.validateTelemetry(raw, topic.deviceId, Date.now());
      if (
        !value ||
        !["browser", "termux"].includes(value.source) ||
        !sameBroker(value.broker_endpoint, state.broker) ||
        !C.acceptsSequence(state.devices.get(topic.deviceId), value) ||
        (!state.devices.has(topic.deviceId) && state.devices.size >= 100)
      )
        return;
      const p = qualified(value),
        fresh = !state.devices.has(p.device_id);
      state.devices.set(p.device_id, p);
      state.points.push(p);
      state.points = state.points.slice(-1000);
      if (!state.selected) state.selected = p.device_id;
      if (fresh)
        log(
          "Telemetri " +
            sourceLabel(p.source) +
            " diterima dari " +
            p.device_id +
            ".",
        );
      render();
    } else if (topic.kind === "status") {
      if (
        raw.device_id !== topic.deviceId ||
        !["browser", "termux"].includes(raw.source) ||
        typeof raw.online !== "boolean" ||
        !C.validId(raw.boot_id) ||
        !finite(raw.sent_at_ms, 0, Date.now() + 60000)
      )
        return;
      const p = state.devices.get(topic.deviceId),
        old = state.statuses.get(topic.deviceId);
      if (p && p.boot_id !== raw.boot_id && raw.sent_at_ms <= p.sent_at_ms)
        return;
      if (old && old.boot_id !== raw.boot_id && raw.sent_at_ms < old.sent_at_ms)
        return;
      if (!old && state.statuses.size >= 100) return;
      state.statuses.set(topic.deviceId, {
        ...raw,
        received_at_ms: Date.now(),
      });
      render();
    } else if (topic.kind === "ack") {
      if (
        message.retained ||
        raw.device_id !== topic.deviceId ||
        !["ok", "error"].includes(raw.status)
      )
        return;
      const pending = state.pending.get(raw.command_id);
      if (
        !pending ||
        pending.deviceId !== topic.deviceId ||
        pending.bootId !== raw.boot_id ||
        pending.action !== raw.action ||
        !finite(raw.sent_at_ms, pending.sentAt - 5000, Date.now() + 60000)
      )
        return;
      clearTimeout(pending.timer);
      state.pending.delete(raw.command_id);
      const detail =
        typeof raw.message === "string" ? raw.message.slice(0, 250) : "";
      text(
        "command-status",
        raw.status === "ok"
          ? "ACK diterima: " + raw.action
          : "Perintah ditolak: " + detail,
      );
      log(
        `ACK ${topic.deviceId}: ${raw.action} · ${raw.status}${detail ? " · " + detail : ""}`,
      );
      toast(
        raw.status === "ok"
          ? "Perangkat mengonfirmasi perintah."
          : "Perintah ditolak oleh perangkat.",
      );
    }
  }
  function sendCommand(action, intervalS) {
    const p = state.devices.get(state.selected);
    if (!p) {
      toast("Pilih perangkat yang sudah mengirim data.");
      return;
    }
    if (state.demo) {
      log(
        "Contoh lokal: " +
          action +
          " → " +
          p.device_id +
          ". Tidak ada pesan ke broker.",
      );
      text("command-status", "Contoh lokal: menunggu konfirmasi…");
      const generation = state.generation;
      setTimeout(() => {
        if (!state.demo || generation !== state.generation) return;
        log("Contoh ACK " + p.device_id + ": " + action + " · ok");
        text("command-status", "Contoh ACK diterima. Ini bukan respons HP.");
      }, 650);
      return;
    }
    if (stale(p) || !state.connected) {
      toast("Perangkat belum aktif atau broker terputus.");
      return;
    }
    if (state.pending.size >= 10) {
      toast("Tunggu konfirmasi perintah sebelumnya.");
      return;
    }
    const sentAt = Date.now(),
      id = C.makeId(),
      payload = {
        command_id: id,
        device_id: p.device_id,
        target_boot_id: p.boot_id,
        action,
        sent_at_ms: sentAt,
        expires_at_ms: sentAt + 15000,
      };
    if (action === "set_interval") payload.interval_s = intervalS;
    const P = window.Paho?.MQTT || window.Paho,
      message = new P.Message(JSON.stringify(payload));
    message.destinationName = C.topic(state.project, p.device_id, "command");
    message.qos = 1;
    message.retained = false;
    const timer = setTimeout(() => {
      state.pending.delete(id);
      log(
        "Perintah " + action + " ke " + p.device_id + " kedaluwarsa tanpa ACK.",
      );
      text(
        "command-status",
        "Belum ada ACK. Periksa apakah tab HP masih aktif.",
      );
    }, 15000);
    state.pending.set(id, {
      deviceId: p.device_id,
      bootId: p.boot_id,
      action,
      sentAt,
      timer,
    });
    try {
      state.client.send(message);
      log("Kirim " + action + " → " + p.device_id + " · berlaku 15 detik.");
      text("command-status", "Menunggu ACK perangkat…");
    } catch (_) {
      clearTimeout(timer);
      state.pending.delete(id);
      text("command-status", "Gagal mengirim perintah.");
    }
  }
  function showDemo() {
    disconnect(false);
    clearData();
    state.demo = true;
    state.project = "contoh-lokal";
    state.broker = "";
    const now = Date.now(),
      settings = [
        ["hp-a", -7.0484, 110.439, [110, 104, 91, 84, 79, 86]],
        ["hp-b", -7.0513, 110.4431, [280, 320, 440, 580, 720, 650]],
      ];
    settings.forEach(([id, lat, lon, values], deviceIndex) =>
      values.forEach((mean, i) => {
        const p = qualified({
          schema_version: 2,
          device_id: id,
          boot_id: "contoh-" + id,
          sequence: i + 1,
          sent_at_ms: now - 60000 + i * 10000,
          source: "demo",
          latency_type: "mqtt_app_rtt",
          latency_ms: mean,
          latency_mean_ms: mean,
          latency_std_ms: deviceIndex ? 40 : 12,
          success_pct: deviceIndex ? 80 : 100,
          probe_count: i + 1,
          probe_ok: true,
          accel_samples: 50,
          gyro_samples: 50,
          accel_rms: 0.03,
          accel_mode: "linear",
          gyro_rms_rad_s: 0.02,
          rotation_total_rad: 0.12,
          accel_available: true,
          gyro_available: true,
          latitude: lat + (i - 5) * 0.00023,
          longitude: lon + (i - 5) * 0.00032,
          accuracy_m: 6 + deviceIndex * 2,
          location_at_ms: now - 60000 + i * 10000,
          interval_s: 5,
          sensor_errors: [],
          broker_endpoint: "wss://example.invalid/mqtt",
        });
        state.points.push(p);
        state.devices.set(id, p);
      }),
    );
    state.selected = "hp-a";
    log(
      "Contoh lokal dibuka. Semua nilai dan lokasi dibuat untuk ilustrasi, bukan dari sensor.",
    );
    render();
  }
  function exportPreview() {
    const samples = visiblePoints();
    if (!samples.length) {
      toast("Belum ada sampel untuk diekspor.");
      return;
    }
    const cols = [
      "mode",
      "project_id",
      "device_id",
      "source",
      "source_label",
      "broker_endpoint",
      "sent_at_ms",
      "latency_ms",
      "latency_mean_ms",
      "latency_std_ms",
      "success_pct",
      "probe_count",
      "probe_ok",
      "accel_rms",
      "accel_mode",
      "accel_available",
      "gyro_rms_rad_s",
      "rotation_total_rad",
      "gyro_available",
      "sensor_window_ms",
      "gyro_covered_ms",
      "latitude",
      "longitude",
      "accuracy_m",
      "sensor_errors",
    ];
    state.csv = [
      cols.join(","),
      ...samples.map((p) =>
        cols
          .map((c) =>
            C.csvCell(
              c === "mode"
                ? state.demo
                  ? "contoh-lokal"
                  : "pengukuran-perangkat"
                : c === "project_id"
                  ? state.project
                  : c === "source_label"
                    ? sourceLabel(p.source)
                    : c === "sensor_errors"
                      ? (p.sensor_errors || []).join("; ")
                      : p[c],
            ),
          )
          .join(","),
      ),
    ].join("\r\n");
    state.csvCount = samples.length;
    state.csvName = `sigheat-${state.demo ? "CONTOH" : state.project}-${state.sourceFilter}-latensi.csv`;
    $("export-preview").value = state.csv;
    text(
      "export-summary",
      `${samples.length} sampel · ${state.demo ? "CONTOH LOKAL, bukan pengukuran nyata" : "Pengukuran perangkat; periksa kolom sumber"} · Periksa pratinjau sebelum mengunduh.`,
    );
    $("export-dialog").showModal();
  }
  async function copyCsv() {
    try {
      await navigator.clipboard.writeText(state.csv);
      toast("CSV disalin.");
    } catch (_) {
      $("export-preview").focus();
      $("export-preview").select();
      toast("Teks dipilih. Salin dengan menu browser atau Ctrl+C.");
    }
  }
  function downloadCsv() {
    if (!state.csv) return;
    const url = URL.createObjectURL(
        new Blob(["\ufeff" + state.csv], { type: "text/csv;charset=utf-8" }),
      ),
      a = el("a");
    a.href = url;
    a.download = state.csvName;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    log(
      "Ekspor CSV: " +
        state.csvCount +
        " sampel " +
        (state.demo ? "contoh lokal." : "pengukuran perangkat."),
    );
  }
  function edgeState(info) {
    const status = info.status,
      busy = ["requesting", "connecting", "running"].includes(status);
    text(
      "participant-status",
      {
        idle: "Siap",
        requesting: "Izin sensor",
        connecting: "Menghubungkan",
        running: "Berjalan",
        paused: "Dijeda",
        stopped: "Berhenti",
        error: "Perlu diperiksa",
      }[status] || status,
    );
    $("participant-status").className =
      "chip " +
      (status === "running" ? "" : status === "error" ? "amber" : "grey");
    text("edge-state", info.detail || status);
    $("edge-start").disabled = busy || !window.isSecureContext;
    $("edge-stop").disabled = !busy;
    $("participant-sample").disabled =
      status !== "running" || info.connection_ready === false;
    [
      "edge-project",
      "edge-device",
      "edge-broker",
      "edge-username",
      "edge-password",
      "edge-interval",
      "edge-share-location",
    ].forEach((id) => ($(id).disabled = busy));
    if (status === "running") text("edge-error", "");
    if (status === "error")
      text(
        "edge-error",
        info.detail ||
          "Pengukuran belum dapat berjalan. Periksa koneksi dan izin.",
      );
  }
  function sensorErrorText(errors) {
    const labels = {
      accelerometer_missing_or_stale:
        "Accelerometer belum mengirim data terkini",
      gyroscope_missing_or_stale: "Gyroscope belum mengirim data terkini",
      gyroscope_event_gap: "Sebagian data rotasi terputus",
      gps_unavailable: "Lokasi tidak tersedia di browser ini",
      gps_waiting: "Menunggu izin atau posisi perangkat",
      gps_invalid: "Koordinat perangkat belum valid",
      gps_denied_or_unavailable:
        "Izin lokasi ditolak atau posisi belum tersedia",
      gps_stale: "Koordinat terakhir sudah kedaluwarsa",
      mqtt_probe_timeout_or_failed:
        "Probe MQTT belum kembali sebelum batas waktu",
    };
    return (errors || [])
      .map(
        (code) =>
          labels[code] ||
          "Ada masalah pembacaan sensor; periksa izin perangkat",
      )
      .join(" · ");
  }
  function edgeSample(p) {
    text("participant-signal", fmt(p.latency_ms) + " ms");
    text(
      "participant-source",
      finite(p.latency_ms)
        ? "Sampel " +
            new Date(p.sent_at_ms).toLocaleTimeString("id-ID") +
            " · pesan kembali melalui broker."
        : "Sampel terakhir belum menerima balasan probe; latensi belum tersedia.",
    );
    text("edge-mean", fmt(p.latency_mean_ms, 1) + " ms");
    text("edge-std", fmt(p.latency_std_ms, 1) + " ms");
    text("edge-success", fmt(p.success_pct) + " %");
    text("edge-probes", p.probe_count ?? 0);
    text(
      "edge-accel",
      p.accel_available && finite(p.accel_rms)
        ? fmt(p.accel_rms, 3) + " m/s²"
        : "Tidak tersedia",
    );
    text(
      "edge-accel-mode",
      p.accel_available
        ? {
            linear: "Percepatan linear dari browser.",
            gravity_removed:
              "Perkiraan gerakan dari selisih besar percepatan dan gravitasi.",
          }[p.accel_mode] || "Data accelerometer tersedia."
        : "Periksa dukungan sensor dan izin browser.",
    );
    text(
      "edge-gyro",
      p.gyro_available && finite(p.gyro_rms_rad_s)
        ? fmt(p.gyro_rms_rad_s, 3) + " rad/s"
        : "Tidak tersedia",
    );
    text(
      "edge-rotation",
      "Total rotasi: " +
        (p.gyro_available && finite(p.rotation_total_rad)
          ? fmt(p.rotation_total_rad, 3) + " rad"
          : "tidak tersedia") +
        (finite(p.sensor_window_ms)
          ? " · jendela " + fmt(p.sensor_window_ms / 1000, 1) + " s"
          : "") +
        (finite(p.gyro_covered_ms)
          ? " · data tercakup " + fmt(p.gyro_covered_ms / 1000, 1) + " s"
          : ""),
    );
    text(
      "edge-gps",
      finite(p.latitude) && finite(p.longitude)
        ? `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`
        : $("edge-share-location").checked
          ? "Belum mendapat koordinat"
          : "Tidak dibagikan",
    );
    text(
      "edge-gps-accuracy",
      finite(p.accuracy_m)
        ? "Akurasi perkiraan ± " + fmt(p.accuracy_m) + " m"
        : "Lokasi hanya dikirim jika Anda mengaktifkan berbagi lokasi.",
    );
    text(
      "edge-sensor-errors",
      (!p.accel_available || !p.gyro_available
        ? "Sensor belum lengkap. "
        : "") + sensorErrorText(p.sensor_errors),
    );
  }
  function startEdge(event) {
    event.preventDefault();
    text("edge-error", "");
    const url = brokerUrl($("edge-broker").value.trim()),
      project = $("edge-project").value.trim(),
      deviceId = $("edge-device").value.trim();
    if (!C.validId(project) || !C.validId(deviceId) || !url) {
      text("edge-error", "Periksa Project ID, ID perangkat, dan alamat WSS.");
      return;
    }
    if (!window.SigHeatEdge?.EdgeClient) {
      text(
        "edge-error",
        "Modul pengukuran belum tersedia. Muat ulang atau periksa berkas aplikasi.",
      );
      return;
    }
    state.edgeGeneration++;
    const generation = state.edgeGeneration;
    if (state.edge) state.edge.stop();
    const config = {
      project,
      deviceId,
      brokerUrl: url.href,
      username: $("edge-username").value,
      password: $("edge-password").value,
      intervalS: Number($("edge-interval").value),
      shareLocation: $("edge-share-location").checked,
    };
    try {
      state.edge = new SigHeatEdge.EdgeClient(config, {
        onState: (info) => {
          if (generation === state.edgeGeneration) edgeState(info);
        },
        onSample: (p) => {
          if (generation === state.edgeGeneration) edgeSample(p);
        },
        onLog: (message) => {
          if (generation === state.edgeGeneration) log(message);
        },
        onAck: (ack) => {
          if (generation === state.edgeGeneration) {
            text(
              "command-status",
              "Perintah " + ack.action + ": " + ack.status,
            );
            log("ACK " + ack.action + " · " + ack.status);
          }
        },
      });
      // Keep this call in the original user-click task for iOS sensor permission prompts.
      const started = state.edge.start();
      Promise.resolve(started).catch((error) => {
        if (generation === state.edgeGeneration) {
          edgeState({
            status: "error",
            detail: String(error?.message || "Pengukuran gagal dimulai."),
          });
        }
      });
    } catch (error) {
      edgeState({
        status: "error",
        detail: String(error?.message || "Pengukuran gagal dimulai."),
      });
    }
  }
  $("clear-log")?.addEventListener("click", () => {
    state.logs = [];
    renderLogs();
  });
  if ($("termux-option")) {
    document.querySelectorAll('a[href="#termux-option"]').forEach((link) =>
      link.addEventListener("click", () => {
        $("termux-option").open = true;
      }),
    );
    if (window.location?.hash === "#termux-option")
      $("termux-option").open = true;
  }
  if (!C) {
    text(
      dashboard ? "mode-text" : "edge-error",
      "Modul aplikasi belum tersedia. Pastikan assets/core.js dimuat.",
    );
    return;
  }
  if (dashboard) {
    document.querySelectorAll("[data-open-connection]").forEach((b) =>
      b.addEventListener("click", () => {
        text("connection-error", "");
        $("connection-dialog").showModal();
      }),
    );
    document
      .querySelectorAll("[data-close-dialog]")
      .forEach((b) => b.addEventListener("click", closeConnection));
    $("connection-dialog").addEventListener("cancel", (e) => {
      e.preventDefault();
      closeConnection();
    });
    $("connection-form").addEventListener("submit", connect);
    $("mode-action").addEventListener("click", () => {
      if (state.demo) {
        disconnect(false);
        clearData();
        state.demo = false;
        state.project = "";
        render();
      } else if (state.connected) disconnect();
      else showDemo();
    });
    document
      .querySelectorAll("[data-view]")
      .forEach((b) =>
        b.addEventListener("click", () => changeView(b.dataset.view)),
      );
    document
      .querySelector("[data-go-devices]")
      .addEventListener("click", () => changeView("devices"));
    $("sample-now").addEventListener("click", () => sendCommand("sample_now"));
    $("set-interval").addEventListener("click", () =>
      sendCommand("set_interval", Number($("interval-select").value)),
    );
    ["points", "grid", "roads"].forEach((mode) =>
      $("map-" + mode).addEventListener("click", () => changeMapMode(mode)),
    );
    $("fit-map").addEventListener("click", () => {
      state.mapFitted = false;
      renderMap();
      toast("Seluruh titik pengukuran ditampilkan.");
    });
    $("source-filter").addEventListener("change", (event) => {
      state.sourceFilter = event.target.value;
      state.mapFitted = false;
      render();
    });
    $("export-csv").addEventListener("click", exportPreview);
    $("close-export").addEventListener("click", () =>
      $("export-dialog").close(),
    );
    $("copy-csv").addEventListener("click", copyCsv);
    $("download-csv").addEventListener("click", downloadCsv);
    setInterval(() => {
      if (state.devices.size && !state.demo) render();
    }, 5000);
    render();
    renderLogs();
  } else {
    $("edge-form").addEventListener("submit", startEdge);
    $("edge-stop").addEventListener("click", () => state.edge?.stop());
    $("participant-sample").addEventListener("click", () => {
      try {
        Promise.resolve(state.edge?.sampleNow()).catch((e) =>
          toast(e?.message || "Sampel belum dapat diminta."),
        );
      } catch (e) {
        toast(e?.message || "Sampel belum dapat diminta.");
      }
    });
    if (!window.isSecureContext) {
      $("secure-context-note").hidden = false;
      $("edge-start").disabled = true;
    }
    edgeState({
      status: "idle",
      detail: "Belum berjalan. Tidak ada data yang dikirim.",
    });
  }
  window.addEventListener("beforeunload", () => {
    state.edgeGeneration++;
    state.edge?.stop();
    disconnect(false);
  });
})();
