/* SigHeat shared Browser/Termux protocol v2. Shared pure helpers; no hardware or network access. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SigHeatCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const ID = /^[A-Za-z0-9_-]{1,48}$/;
  const validId = (value) => typeof value === "string" && ID.test(value);
  const finite = (n, min = -Infinity, max = Infinity) =>
    typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
  const optional = (n, min, max) => n == null || finite(n, min, max);
  function makeId(prefix = "id") {
    const bytes = new Uint8Array(12);
    if (typeof crypto !== "undefined" && crypto.getRandomValues)
      crypto.getRandomValues(bytes);
    else
      for (let i = 0; i < bytes.length; i++)
        bytes[i] = Math.floor(Math.random() * 256);
    return (
      prefix +
      "-" +
      Array.from(bytes, (n) => n.toString(16).padStart(2, "0")).join("")
    );
  }
  function endpoint(value) {
    try {
      const url = new URL(value);
      if (
        url.protocol !== "wss:" ||
        !url.hostname ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        return null;
      return url.href;
    } catch (_) {
      return null;
    }
  }
  function topic(project, deviceId, kind) {
    if (
      !validId(project) ||
      !validId(deviceId) ||
      !["telemetry", "status", "command", "ack"].includes(kind)
    )
      throw new Error("ID/topic tidak valid.");
    return `sigheat/${project}/edge/${deviceId}/${kind}`;
  }
  function parseTopic(value, project) {
    if (typeof value !== "string" || !validId(project)) return null;
    const parts = value.split("/");
    if (
      parts.length !== 5 ||
      parts[0] !== "sigheat" ||
      parts[1] !== project ||
      parts[2] !== "edge" ||
      !validId(parts[3]) ||
      !["telemetry", "status", "command", "ack"].includes(parts[4])
    )
      return null;
    return { deviceId: parts[3], kind: parts[4] };
  }
  function quality(meanMs, successPct) {
    if (!finite(meanMs, 0, 60000) || !finite(successPct, 0, 100))
      return "unknown";
    return meanMs <= 150 && successPct >= 90
      ? "good"
      : meanMs <= 500 && successPct >= 70
        ? "fair"
        : "poor";
  }
  function validateTelemetry(v, deviceId, now = Date.now(), options = {}) {
    if (
      !v ||
      typeof v !== "object" ||
      Array.isArray(v) ||
      v.schema_version !== 2 ||
      v.latency_type !== "mqtt_app_rtt" ||
      !validId(deviceId) ||
      v.device_id !== deviceId ||
      !validId(v.boot_id)
    )
      return null;
    if (
      !["browser", "termux"].includes(v.source) &&
      !(options.allowDemo && v.source === "demo")
    )
      return null;
    if (
      !Number.isSafeInteger(v.sequence) ||
      v.sequence < 1 ||
      !finite(v.sent_at_ms, now - 600000, now + 30000)
    )
      return null;
    const broker = endpoint(v.broker_endpoint);
    if (
      !broker ||
      !finite(v.interval_s, 2, 60) ||
      typeof v.probe_ok !== "boolean"
    )
      return null;
    if (
      !Number.isInteger(v.probe_count) ||
      v.probe_count < 1 ||
      v.probe_count > 10
    )
      return null;
    if (
      !optional(v.latency_ms, 0, 60000) ||
      !optional(v.latency_mean_ms, 0, 60000) ||
      !optional(v.latency_std_ms, 0, 60000) ||
      !finite(v.success_pct, 0, 100)
    )
      return null;
    if (v.probe_ok !== (v.latency_ms != null)) return null;
    if (
      v.success_pct === 0 &&
      (v.latency_mean_ms != null || v.latency_std_ms != null)
    )
      return null;
    if (v.success_pct > 0 && v.latency_mean_ms == null) return null;
    if (v.probe_ok && v.success_pct === 0) return null;
    if (
      !optional(v.accel_rms, 0, 1000) ||
      !optional(v.gyro_rms_rad_s, 0, 1000) ||
      !optional(v.rotation_total_rad, 0, 100000)
    )
      return null;
    if (
      typeof v.accel_available !== "boolean" ||
      typeof v.gyro_available !== "boolean" ||
      !["linear", "gravity_removed", "unavailable"].includes(v.accel_mode)
    )
      return null;
    if (
      v.accel_available !== (v.accel_rms != null) ||
      v.gyro_available !== (v.gyro_rms_rad_s != null)
    )
      return null;
    if ((v.accel_mode === "unavailable") !== !v.accel_available) return null;
    const hasGeo =
      finite(v.latitude, -85, 85) && finite(v.longitude, -180, 180);
    if ((v.latitude != null || v.longitude != null) && !hasGeo) return null;
    if (
      !optional(v.accuracy_m, 0, 100000) ||
      !optional(v.location_at_ms, 0, now + 30000)
    )
      return null;
    if (
      hasGeo &&
      (v.accuracy_m == null ||
        v.location_at_ms == null ||
        now - v.location_at_ms > 60000)
    )
      return null;
    return {
      schema_version: 2,
      device_id: deviceId,
      boot_id: v.boot_id,
      sequence: v.sequence,
      sent_at_ms: v.sent_at_ms,
      received_at_ms: now,
      source: v.source,
      latency_type: "mqtt_app_rtt",
      broker_endpoint: broker,
      latency_ms: v.latency_ms ?? null,
      latency_mean_ms: v.latency_mean_ms ?? null,
      latency_std_ms: v.latency_std_ms ?? null,
      success_pct: v.success_pct,
      probe_count: v.probe_count,
      probe_ok: v.probe_ok,
      connection_quality: v.probe_ok
        ? quality(v.latency_mean_ms, v.success_pct)
        : "poor",
      accel_rms: v.accel_rms ?? null,
      accel_mode: v.accel_mode,
      gyro_rms_rad_s: v.gyro_rms_rad_s ?? null,
      rotation_total_rad: v.rotation_total_rad ?? null,
      accel_available: v.accel_available,
      gyro_available: v.gyro_available,
      accel_samples:
        Number.isInteger(v.accel_samples) &&
        v.accel_samples >= 0 &&
        v.accel_samples <= 100000
          ? v.accel_samples
          : 0,
      gyro_samples:
        Number.isInteger(v.gyro_samples) &&
        v.gyro_samples >= 0 &&
        v.gyro_samples <= 100000
          ? v.gyro_samples
          : 0,
      sensor_window_ms: finite(v.sensor_window_ms, 0, 600000)
        ? v.sensor_window_ms
        : null,
      gyro_covered_ms: finite(v.gyro_covered_ms, 0, 600000)
        ? v.gyro_covered_ms
        : null,
      latitude: hasGeo ? v.latitude : null,
      longitude: hasGeo ? v.longitude : null,
      accuracy_m: v.accuracy_m ?? null,
      location_at_ms: v.location_at_ms ?? null,
      interval_s: v.interval_s,
      sensor_errors: Array.isArray(v.sensor_errors)
        ? v.sensor_errors
            .filter((x) => typeof x === "string")
            .slice(0, 12)
            .map((x) => x.slice(0, 120))
        : [],
    };
  }
  function validateCommand(v, deviceId, now = Date.now(), targetBootId = null) {
    if (
      !v ||
      typeof v !== "object" ||
      Array.isArray(v) ||
      !validId(deviceId) ||
      v.device_id !== deviceId ||
      !validId(v.command_id)
    )
      return null;
    if (
      !validId(v.target_boot_id) ||
      (targetBootId !== null && v.target_boot_id !== targetBootId)
    )
      return null;
    if (!["sample_now", "set_interval"].includes(v.action)) return null;
    if (
      !finite(v.sent_at_ms, now - 30000, now + 5000) ||
      !finite(v.expires_at_ms, now, now + 35000) ||
      v.expires_at_ms <= v.sent_at_ms ||
      v.expires_at_ms - v.sent_at_ms > 30000
    )
      return null;
    if (v.action === "set_interval" && !finite(v.interval_s, 2, 60))
      return null;
    return {
      command_id: v.command_id,
      device_id: deviceId,
      target_boot_id: v.target_boot_id,
      action: v.action,
      sent_at_ms: v.sent_at_ms,
      expires_at_ms: v.expires_at_ms,
      ...(v.action === "set_interval" ? { interval_s: v.interval_s } : {}),
    };
  }
  function acceptsSequence(previous, incoming) {
    if (
      !incoming ||
      !Number.isSafeInteger(incoming.sequence) ||
      !finite(incoming.sent_at_ms)
    )
      return false;
    if (!previous) return true;
    return previous.boot_id === incoming.boot_id
      ? incoming.sequence > previous.sequence &&
          incoming.sent_at_ms >= previous.sent_at_ms
      : incoming.sent_at_ms > previous.sent_at_ms;
  }
  function csvCell(value) {
    let text = value == null ? "" : String(value);
    if (/^[\s]*[=+@-]/.test(text) && typeof value !== "number")
      text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function filterBySource(rows, source = "all") {
    if (!Array.isArray(rows) || !["all", "browser", "termux"].includes(source))
      return [];
    return rows.filter(
      (row) => row && (source === "all" || row.source === source),
    );
  }
  function aggregateGrid(rows, cellMeters = 25) {
    if (!finite(cellMeters, 10, 10000) || !Array.isArray(rows)) return [];
    const buckets = new Map();
    const origins = new Map();
    for (const row of rows.slice(-5000)) {
      if (
        !finite(row.latitude, -85, 85) ||
        !finite(row.longitude, -180, 180) ||
        !finite(row.accuracy_m, 0, Math.max(50, cellMeters * 2)) ||
        !endpoint(row.broker_endpoint)
      )
        continue;
      const scope = `${row.source}|${row.broker_endpoint}`;
      if (!origins.has(scope)) origins.set(scope, row.latitude);
      const y = row.latitude * 111320;
      const x =
        row.longitude * 111320 * Math.cos((origins.get(scope) * Math.PI) / 180);
      const ix = Math.floor(x / cellMeters),
        iy = Math.floor(y / cellMeters);
      const longitudeScale =
        111320 * Math.cos((origins.get(scope) * Math.PI) / 180);
      const key = `${scope}|${ix}|${iy}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          latitude: ((iy + 0.5) * cellMeters) / 111320,
          longitude: ((ix + 0.5) * cellMeters) / longitudeScale,
          bounds: {
            south: (iy * cellMeters) / 111320,
            north: ((iy + 1) * cellMeters) / 111320,
            west: (ix * cellMeters) / longitudeScale,
            east: ((ix + 1) * cellMeters) / longitudeScale,
          },
          count: 0,
          success: 0,
          total: 0,
          source: row.source,
          broker_endpoint: row.broker_endpoint,
        };
        buckets.set(key, bucket);
      }
      bucket.count++;
      if (row.probe_ok && finite(row.latency_ms, 0, 60000)) {
        bucket.success++;
        bucket.total += row.latency_ms;
      }
    }
    return Array.from(buckets.values(), (b) => {
      const mean = b.success ? b.total / b.success : null;
      const success = (b.success / b.count) * 100;
      return {
        latitude: b.latitude,
        longitude: b.longitude,
        bounds: b.bounds,
        count: b.count,
        latency_mean_ms: mean,
        success_pct: success,
        quality: mean == null ? "poor" : quality(mean, success),
        source: b.source,
        broker_endpoint: b.broker_endpoint,
      };
    });
  }
  return {
    validId,
    finite,
    makeId,
    endpoint,
    topic,
    parseTopic,
    quality,
    validateTelemetry,
    validateCommand,
    acceptsSequence,
    csvCell,
    aggregateGrid,
    filterBySource,
  };
});
