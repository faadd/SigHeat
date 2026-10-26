/* SigHeat actual browser edge. MQTT application round-trip is NOT radio strength. */
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./core.js"), root);
  else root.SigHeatEdge = factory(root.SigHeatCore, root);
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function (Core, defaultEnv) {
    "use strict";
    const DEG = Math.PI / 180;
    const GRAVITY = 9.80665;
    const round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;
    const magnitude = (v, keys, limit) =>
      v && keys.every((k) => Core.finite(v[k], -limit, limit))
        ? Math.hypot(...keys.map((k) => v[k]))
        : null;
    class EdgeClient {
      constructor(config, callbacks = {}, environment = defaultEnv) {
        if (
          !config ||
          !Core.validId(config.project) ||
          !Core.validId(config.deviceId)
        )
          throw new Error(
            "Project ID dan Device ID harus huruf, angka, - atau _.",
          );
        const broker = Core.endpoint(config.brokerUrl);
        if (!broker)
          throw new Error(
            "Gunakan alamat broker wss:// tanpa kredensial di URL.",
          );
        const interval = config.intervalS ?? 5;
        if (!Core.finite(interval, 2, 60))
          throw new Error("Interval harus 2–60 detik.");
        this.config = {
          ...config,
          brokerUrl: broker,
          intervalS: interval,
          shareLocation: config.shareLocation === true,
        };
        this.callbacks = callbacks;
        this.env = environment;
        this.status = "idle";
        this.active = false;
        this.ready = false;
        this.generation = 0;
        this.sequence = 0;
        this.bootId = null;
        this.client = null;
        this.accel = [];
        this.gyro = [];
        this.attempts = [];
        this._resetStats();
        this.geo = null;
        this.geoError = null;
        this.motionMode = "unavailable";
        this.timer = null;
        this.probe = null;
        this.geoWatch = null;
        this.commands = new Map();
        this.lastCommandAt = -Infinity;
        this.lastSampleAt = -Infinity;
        this.motionListener = (event) => this._motion(event);
        this.visibilityListener = () => {
          if (this.env.document.hidden && this.active)
            this._teardown(
              "paused",
              "Pengukuran dijeda karena tab tidak terlihat. Kembali ke tab, lalu tekan Mulai lagi.",
            );
        };
        this.unloadListener = () => this.stop();
      }
      _resetStats() {
        this.stats = {
          aCount: 0,
          aSum: 0,
          gCount: 0,
          gSum: 0,
          rotation: 0,
          pairs: 0,
          coveredMs: 0,
          gap: false,
          lastGyro: null,
        };
      }
      _now() {
        return this.env.performance.now();
      }
      _wall() {
        return this.env.Date ? this.env.Date.now() : Date.now();
      }
      _call(name, value) {
        try {
          if (typeof this.callbacks[name] === "function")
            this.callbacks[name](value);
        } catch (_) {}
      }
      _state(status, detail) {
        this.status = status;
        this._call("onState", {
          status,
          detail,
          connection_ready: this.ready,
          boot_id: this.bootId,
        });
      }
      _log(text) {
        this._call("onLog", text);
      }
      _alive(generation) {
        return this.active && generation === this.generation;
      }
      _paho() {
        const p = this.env.Paho;
        return p && (p.Client ? p : p.MQTT);
      }
      _topic(kind) {
        return Core.topic(this.config.project, this.config.deviceId, kind);
      }
      async start() {
        if (this.active) return;
        if (!this.env.isSecureContext) {
          this._state(
            "error",
            "Sensor memerlukan HTTPS atau localhost tepercaya. HTTP alamat IP LAN tidak cukup.",
          );
          throw new Error("Secure context diperlukan.");
        }
        if (this.env.document.hidden) {
          this._state("paused", "Buka tab ini sebelum mulai.");
          return;
        }
        if (!this._paho()) {
          this._state("error", "Pustaka MQTT belum tersedia.");
          throw new Error("Paho tidak tersedia.");
        }
        this.active = true;
        this.ready = false;
        const generation = ++this.generation;
        this.bootId = Core.makeId("boot");
        this.sequence = 0;
        this.accel = [];
        this.gyro = [];
        this.attempts = [];
        this._resetStats();
        this.commands.clear();
        this.geo = null;
        this.geoError = null;
        this.motionMode = "unavailable";
        this.lastSampleAt = -Infinity;
        this.lastCommandAt = -Infinity;
        this.windowStart = this._now();
        this._state("requesting", "Meminta izin sensor pada perangkat ini.");
        // Must run before ANY await, while the button's user activation exists (iOS).
        let permission;
        try {
          const Motion = this.env.DeviceMotionEvent;
          permission =
            Motion && typeof Motion.requestPermission === "function"
              ? Motion.requestPermission()
              : Promise.resolve("granted");
        } catch (error) {
          this._teardown(
            "error",
            "Izin sensor gagal. Tekan Mulai melalui tombol dan izinkan sensor.",
          );
          throw error;
        }
        try {
          const granted = await permission;
          if (!this._alive(generation)) return;
          if (this.env.document.hidden) {
            this._teardown(
              "paused",
              "Tab tersembunyi. Kembali ke tab lalu tekan Mulai lagi.",
            );
            return;
          }
          if (granted !== "granted")
            this._log(
              "Izin sensor gerak ditolak; data accelerometer dan gyroscope akan kosong.",
            );
          if (granted === "granted")
            this.env.addEventListener("devicemotion", this.motionListener);
          this.env.document.addEventListener(
            "visibilitychange",
            this.visibilityListener,
          );
          this.env.addEventListener("pagehide", this.unloadListener);
          if (this.config.shareLocation) this._watchLocation(generation);
          this._state(
            "connecting",
            "Menghubungkan broker dan menunggu konfirmasi langganan.",
          );
          await this._connect(generation);
          if (!this._alive(generation)) return;
          this.ready = true;
          this._state(
            "running",
            "Terhubung. Jaga tab tetap terlihat saat pengukuran.",
          );
          this._send(this._topic("status"), this._status(true), true, 0);
          this._schedule(500);
        } catch (error) {
          if (this._alive(generation)) {
            this._teardown(
              "error",
              "Tidak dapat memulai. Periksa izin, koneksi, broker, dan ACL.",
            );
            throw error;
          }
        }
      }
      _status(online) {
        return {
          schema_version: 2,
          device_id: this.config.deviceId,
          boot_id: this.bootId,
          online,
          source: "browser",
          sent_at_ms: this._wall(),
        };
      }
      _watchLocation(generation) {
        if (!this.env.navigator.geolocation) {
          this.geoError = "gps_unavailable";
          return;
        }
        this.geoError = "gps_waiting";
        try {
          this.geoWatch = this.env.navigator.geolocation.watchPosition(
            (position) => {
              if (!this._alive(generation)) return;
              const p = position.coords;
              if (
                !Core.finite(p.latitude, -85, 85) ||
                !Core.finite(p.longitude, -180, 180) ||
                !Core.finite(p.accuracy, 0, 100000)
              ) {
                this.geoError = "gps_invalid";
                return;
              }
              this.geo = {
                latitude: round(p.latitude, 5),
                longitude: round(p.longitude, 5),
                accuracy_m: round(p.accuracy, 1),
                location_at_ms: position.timestamp,
              };
              this.geoError = null;
            },
            () => {
              if (this._alive(generation)) {
                this.geoError = "gps_denied_or_unavailable";
                this.geo = null;
              }
            },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
          );
        } catch (_) {
          this.geoError = "gps_unavailable";
        }
      }
      _motion(event) {
        if (!this.active || this.env.document.hidden) return;
        const t = this._now();
        const linear = magnitude(event.acceleration, ["x", "y", "z"], 1000);
        const gravity = magnitude(
          event.accelerationIncludingGravity,
          ["x", "y", "z"],
          1000,
        );
        const value =
          linear != null ? linear : gravity != null ? gravity - GRAVITY : null;
        const mode =
          linear != null
            ? "linear"
            : gravity != null
              ? "gravity_removed"
              : "unavailable";
        if (value != null) {
          if (this.motionMode !== mode) {
            this.accel = [];
            this.stats.aCount = 0;
            this.stats.aSum = 0;
          }
          this.motionMode = mode;
          this.stats.aCount++;
          this.stats.aSum += value * value;
          this.accel.push({ t, square: value * value });
          if (this.accel.length > 1000) this.accel.shift();
        }
        const rotation = magnitude(
          event.rotationRate,
          ["alpha", "beta", "gamma"],
          36000,
        );
        if (rotation != null) {
          const omega = rotation * DEG;
          const previous = this.stats.lastGyro;
          this.stats.gCount++;
          this.stats.gSum += omega * omega;
          if (previous) {
            const dt = (t - previous.t) / 1000;
            if (dt > 0 && dt <= 0.5) {
              this.stats.rotation += ((previous.omega + omega) / 2) * dt;
              this.stats.pairs++;
              this.stats.coveredMs += dt * 1000;
            } else if (dt > 0.5) this.stats.gap = true;
          }
          this.stats.lastGyro = { t, omega };
          this.gyro.push({ t, omega });
          if (this.gyro.length > 1000) this.gyro.shift();
        }
      }
      _snapshot() {
        const now = this._now();
        const accelFresh =
          this.accel.length &&
          now - this.accel[this.accel.length - 1].t <= 5000;
        const gyroFresh =
          this.gyro.length && now - this.gyro[this.gyro.length - 1].t <= 5000;
        const aCount = accelFresh ? this.stats.aCount : 0;
        const gCount = gyroFresh ? this.stats.gCount : 0;
        const stats = this.stats;
        const windowMs = now - this.windowStart;
        const errors = [];
        if (!aCount) errors.push("accelerometer_missing_or_stale");
        if (!gCount) errors.push("gyroscope_missing_or_stale");
        if (stats.gap) errors.push("gyroscope_event_gap");
        if (this.config.shareLocation && this.geoError)
          errors.push(this.geoError);
        let geo = null;
        if (
          this.config.shareLocation &&
          this.geo &&
          Core.finite(
            this.geo.location_at_ms,
            this._wall() - 60000,
            this._wall() + 5000,
          )
        )
          geo = this.geo;
        else if (this.config.shareLocation && this.geo)
          errors.push("gps_stale");
        this.windowStart = now;
        this._resetStats();
        return {
          accel_rms: aCount ? round(Math.sqrt(stats.aSum / aCount), 4) : null,
          accel_mode: aCount ? this.motionMode : "unavailable",
          accel_available: !!aCount,
          accel_samples: aCount,
          gyro_rms_rad_s: gCount
            ? round(Math.sqrt(stats.gSum / gCount), 4)
            : null,
          rotation_total_rad:
            gCount && stats.pairs ? round(stats.rotation, 4) : null,
          gyro_available: !!gCount,
          gyro_samples: gCount,
          sensor_window_ms: round(windowMs),
          gyro_covered_ms:
            gCount && stats.pairs ? round(stats.coveredMs) : null,
          latitude: geo ? geo.latitude : null,
          longitude: geo ? geo.longitude : null,
          accuracy_m: geo ? geo.accuracy_m : null,
          location_at_ms: geo ? geo.location_at_ms : null,
          sensor_errors: errors,
        };
      }
      _connect(generation) {
        const Paho = this._paho();
        const client = new Paho.Client(
          this.config.brokerUrl,
          Core.makeId("edge"),
        );
        this.client = client;
        this.probeTopic = `sigheat/${this.config.project}/probe/${this.bootId}`;
        const will = new Paho.Message(JSON.stringify(this._status(false)));
        will.destinationName = this._topic("status");
        will.qos = 0;
        will.retained = true;
        client.onMessageArrived = (message) => {
          if (this._alive(generation)) this._message(message);
        };
        client.onConnectionLost = (response) => {
          if (!this._alive(generation)) return;
          this._teardown(
            "error",
            "Koneksi broker terputus. Periksa jaringan lalu tekan Mulai lagi.",
          );
        };
        return new Promise((resolve, reject) => {
          let settled = false;
          let timer;
          const finish = (error) => {
            if (settled) return;
            settled = true;
            this.env.clearTimeout(timer);
            this.cancelConnect = null;
            if (error) reject(error);
            else resolve();
          };
          this.cancelConnect = () => finish(new Error("Connection cancelled"));
          timer = this.env.setTimeout(
            () => finish(new Error("Connection timeout")),
            15000,
          );
          const subscribe = (name) =>
            new Promise((done, fail) => {
              client.subscribe(name, {
                qos: 0,
                timeout: 5,
                onSuccess: (response) => {
                  if (
                    response &&
                    response.grantedQos &&
                    response.grantedQos.some((q) => q === 128)
                  )
                    fail(new Error("Subscription rejected"));
                  else done();
                },
                onFailure: () => fail(new Error("Subscription rejected")),
              });
            });
          const options = {
            useSSL: true,
            timeout: 10,
            keepAliveInterval: 30,
            cleanSession: true,
            reconnect: false,
            willMessage: will,
            onSuccess: () => {
              if (!this._alive(generation)) {
                try {
                  client.disconnect();
                } catch (_) {}
                finish(new Error("Cancelled"));
                return;
              }
              Promise.all([
                subscribe(this.probeTopic),
                subscribe(this._topic("command")),
              ]).then(() => finish(), finish);
            },
            onFailure: () => finish(new Error("MQTT connection failed")),
          };
          if (this.config.username) {
            options.userName = this.config.username;
            options.password = this.config.password || "";
          }
          try {
            client.connect(options);
          } catch (error) {
            finish(error);
          }
        });
      }
      _send(topic, payload, retained = false, qos = 0) {
        if (!this.client || !this.client.isConnected()) return false;
        try {
          const message = new (this._paho().Message)(JSON.stringify(payload));
          message.destinationName = topic;
          message.qos = qos;
          message.retained = retained;
          this.client.send(message);
          return true;
        } catch (_) {
          return false;
        }
      }
      _message(message) {
        let value;
        try {
          if (
            message.retained ||
            (message.payloadBytes && message.payloadBytes.byteLength > 16384)
          )
            return;
          const raw = message.payloadString;
          if (typeof raw !== "string" || raw.length > 16384) return;
          value = JSON.parse(raw);
        } catch (_) {
          return;
        }
        if (message.destinationName === this.probeTopic) {
          if (
            this.probe &&
            value &&
            value.nonce === this.probe.nonce &&
            value.boot_id === this.bootId
          )
            this._finishProbe({
              ok: true,
              latency: this._now() - this.probe.started,
            });
          return;
        }
        if (message.destinationName !== this._topic("command")) return;
        const command = Core.validateCommand(
          value,
          this.config.deviceId,
          this._wall(),
          this.bootId,
        );
        if (!command) return;
        if (this.commands.has(command.command_id)) {
          this._send(this._topic("ack"), this.commands.get(command.command_id));
          return;
        }
        const ack = {
          schema_version: 2,
          command_id: command.command_id,
          device_id: this.config.deviceId,
          boot_id: this.bootId,
          action: command.action,
          status: "error",
          message: "",
          sent_at_ms: this._wall(),
        };
        if (!this.ready || this._now() - this.lastCommandAt < 2000)
          ack.message = "Tunggu dua detik sebelum perintah berikutnya.";
        else if (
          command.action === "sample_now" &&
          (this.probe || this._now() - this.lastSampleAt < 2000)
        )
          ack.message = "Pengukuran masih berjalan. Tunggu hasilnya.";
        else {
          this.lastCommandAt = this._now();
          ack.status = "ok";
          if (command.action === "set_interval") {
            this.setInterval(command.interval_s);
            ack.interval_s = this.config.intervalS;
            ack.message = "Interval diperbarui.";
          } else {
            this.sampleNow();
            ack.message = "Pengukuran diminta. Tunggu telemetri berikutnya.";
          }
        }
        this.commands.set(command.command_id, ack);
        if (this.commands.size > 100)
          this.commands.delete(this.commands.keys().next().value);
        this._send(this._topic("ack"), ack);
        this._call("onAck", ack);
      }
      _runProbe() {
        return new Promise((resolve) => {
          const nonce = Core.makeId("nonce");
          const timer = this.env.setTimeout(
            () => this._finishProbe({ ok: false, latency: null }),
            5000,
          );
          this.probe = { nonce, timer, resolve, started: this._now() };
          if (!this._send(this.probeTopic, { nonce, boot_id: this.bootId }))
            this._finishProbe({ ok: false, latency: null });
        });
      }
      _finishProbe(result) {
        if (!this.probe) return;
        const probe = this.probe;
        this.probe = null;
        this.env.clearTimeout(probe.timer);
        probe.resolve(result);
      }
      async sampleNow() {
        if (
          !this.active ||
          !this.ready ||
          this.probe ||
          this._now() - this.lastSampleAt < 2000 ||
          this.env.document.hidden
        )
          return null;
        this.env.clearTimeout(this.timer);
        this.timer = null;
        this.lastSampleAt = this._now();
        const generation = this.generation;
        const result = await this._runProbe();
        if (!this._alive(generation) || result.cancelled) return null;
        const latency =
          result.ok && Core.finite(result.latency, 0, 60000)
            ? round(result.latency)
            : null;
        this.attempts.push(latency);
        if (this.attempts.length > 10) this.attempts.shift();
        const valid = this.attempts.filter((v) => v != null);
        const mean = valid.length
          ? valid.reduce((a, b) => a + b, 0) / valid.length
          : null;
        const std =
          valid.length >= 2
            ? Math.sqrt(
                valid.reduce((s, n) => s + (n - mean) ** 2, 0) / valid.length,
              )
            : null;
        const sensors = this._snapshot();
        if (latency == null)
          sensors.sensor_errors.push("mqtt_probe_timeout_or_failed");
        const payload = {
          schema_version: 2,
          source: "browser",
          device_id: this.config.deviceId,
          boot_id: this.bootId,
          sequence: ++this.sequence,
          sent_at_ms: this._wall(),
          interval_s: this.config.intervalS,
          latency_type: "mqtt_app_rtt",
          broker_endpoint: this.config.brokerUrl,
          latency_ms: latency,
          latency_mean_ms: mean == null ? null : round(mean),
          latency_std_ms: std == null ? null : round(std),
          success_pct: round((valid.length / this.attempts.length) * 100, 1),
          probe_count: this.attempts.length,
          probe_ok: latency != null,
          ...sensors,
        };
        this._call("onSample", payload);
        if (!this._send(this._topic("telemetry"), payload))
          this._log("Hasil lokal tersedia, tetapi telemetri belum terkirim.");
        if (this._alive(generation))
          this._schedule(
            Math.max(
              100,
              this.config.intervalS * 1000 - (this._now() - this.lastSampleAt),
            ),
          );
        return payload;
      }
      _schedule(delay) {
        this.env.clearTimeout(this.timer);
        if (this.active && this.ready)
          this.timer = this.env.setTimeout(() => this.sampleNow(), delay);
      }
      setInterval(seconds) {
        if (!Core.finite(seconds, 2, 60))
          throw new Error("Interval harus 2–60 detik.");
        this.config.intervalS = seconds;
        if (this.active && this.ready && !this.probe)
          this._schedule(
            Math.max(100, seconds * 1000 - (this._now() - this.lastSampleAt)),
          );
        return seconds;
      }
      _teardown(status, detail) {
        this.active = false;
        this.ready = false;
        ++this.generation;
        this.env.clearTimeout(this.timer);
        this.timer = null;
        this._finishProbe({ cancelled: true });
        if (this.cancelConnect) this.cancelConnect();
        this.env.removeEventListener("devicemotion", this.motionListener);
        this.env.removeEventListener("pagehide", this.unloadListener);
        this.env.document.removeEventListener(
          "visibilitychange",
          this.visibilityListener,
        );
        if (this.geoWatch != null && this.env.navigator.geolocation)
          this.env.navigator.geolocation.clearWatch(this.geoWatch);
        this.geoWatch = null;
        if (this.client) {
          this._send(this._topic("status"), this._status(false), true, 0);
          try {
            this.client.disconnect();
          } catch (_) {}
          this.client = null;
        }
        this.accel = [];
        this.gyro = [];
        this.geo = null;
        this._state(status, detail);
      }
      stop() {
        this._teardown("stopped", "Pengukuran dihentikan.");
      }
    }
    return { EdgeClient };
  },
);
