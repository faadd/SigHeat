const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../assets/core.js");
const now = 1800000000000;
const sample = (overrides = {}) => ({
  schema_version: 2,
  latency_type: "mqtt_app_rtt",
  device_id: "hp-a",
  boot_id: "boot-a",
  sequence: 1,
  sent_at_ms: now,
  source: "browser",
  broker_endpoint: "wss://broker.hivemq.com:8884/mqtt",
  interval_s: 5,
  latency_ms: 100,
  latency_mean_ms: 100,
  latency_std_ms: null,
  success_pct: 100,
  probe_count: 1,
  probe_ok: true,
  accel_rms: 0.02,
  accel_mode: "linear",
  gyro_rms_rad_s: 0.1,
  rotation_total_rad: 0.02,
  accel_available: true,
  gyro_available: true,
  accel_samples: 10,
  gyro_samples: 10,
  latitude: -7.05,
  longitude: 110.44,
  accuracy_m: 8,
  location_at_ms: now,
  sensor_errors: [],
  ...overrides,
});
test("topic schema rejects wildcards and crosses project boundaries", () => {
  assert.equal(
    C.topic("team1", "hp-a", "telemetry"),
    "sigheat/team1/edge/hp-a/telemetry",
  );
  assert.deepEqual(C.parseTopic("sigheat/team1/edge/hp-a/ack", "team1"), {
    deviceId: "hp-a",
    kind: "ack",
  });
  assert.equal(C.parseTopic("sigheat/team2/edge/hp-a/ack", "team1"), null);
  assert.throws(() => C.topic("team/#", "hp-a", "telemetry"));
});
test("v2 telemetry validates units/nulls and rejects local demo on wire", () => {
  const valid = C.validateTelemetry(sample(), "hp-a", now);
  assert.equal(valid.connection_quality, "good");
  assert.equal(valid.latency_type, "mqtt_app_rtt");
  assert.equal(valid.latency_std_ms, null);
  assert.equal(
    C.validateTelemetry(sample({ source: "demo" }), "hp-a", now),
    null,
  );
  assert.equal(
    C.validateTelemetry(sample({ source: "demo" }), "hp-a", now, {
      allowDemo: true,
    }).source,
    "demo",
  );
  assert.equal(
    C.validateTelemetry(sample({ source: "termux" }), "hp-a", now).source,
    "termux",
  );
  assert.equal(
    C.validateTelemetry(sample({ source: "legacy" }), "hp-a", now),
    null,
  );
  assert.equal(
    C.validateTelemetry(sample({ latency_type: "wifi_rssi" }), "hp-a", now),
    null,
  );
  assert.equal(
    C.validateTelemetry(sample({ latency_type: undefined }), "hp-a", now),
    null,
  );
  assert.equal(
    C.validateTelemetry(
      sample({ source: "termux", schema_version: 1 }),
      "hp-a",
      now,
    ),
    null,
  );
  assert.equal(
    C.validateTelemetry(sample({ latency_ms: null }), "hp-a", now),
    null,
  );
  assert.equal(
    C.validateTelemetry(sample({ success_pct: 0 }), "hp-a", now),
    null,
  );
  assert.equal(
    C.validateTelemetry(sample({ accel_rms: null }), "hp-a", now),
    null,
  );
  assert.equal(
    C.validateTelemetry(sample({ sent_at_ms: now - 700000 }), "hp-a", now),
    null,
  );
  assert.equal(
    C.validateTelemetry(sample({ location_at_ms: now - 70000 }), "hp-a", now),
    null,
  );
});
test("missing sensors and failed roundtrip remain unknown/null, not zero", () => {
  const value = C.validateTelemetry(
    sample({
      probe_ok: false,
      latency_ms: null,
      latency_mean_ms: null,
      latency_std_ms: null,
      success_pct: 0,
      accel_rms: null,
      accel_available: false,
      accel_mode: "unavailable",
      gyro_rms_rad_s: null,
      gyro_available: false,
      rotation_total_rad: null,
    }),
    "hp-a",
    now,
  );
  assert.ok(value);
  assert.equal(value.accel_rms, null);
  assert.equal(value.latency_mean_ms, null);
  assert.equal(value.connection_quality, "poor");
});
test("commands require current boot, intended device, expiry and interval bounds", () => {
  const command = {
    command_id: "cmd1",
    device_id: "hp-a",
    target_boot_id: "boot-a",
    action: "set_interval",
    interval_s: 5,
    sent_at_ms: now,
    expires_at_ms: now + 15000,
  };
  assert.ok(C.validateCommand(command, "hp-a", now, "boot-a"));
  for (const change of [
    { target_boot_id: "old-boot" },
    { device_id: "hp-b" },
    { interval_s: 1 },
    { interval_s: 61 },
    { interval_s: "5" },
    { expires_at_ms: now - 1 },
    { expires_at_ms: now + 40000 },
    { action: "reboot" },
  ])
    assert.equal(
      C.validateCommand({ ...command, ...change }, "hp-a", now, "boot-a"),
      null,
    );
});
test("sequence replay and old boot messages do not override newer measurements", () => {
  const first = sample();
  assert.equal(C.acceptsSequence(null, first), true);
  assert.equal(C.acceptsSequence(first, first), false);
  assert.equal(C.acceptsSequence(first, sample({ sequence: 2 })), true);
  assert.equal(
    C.acceptsSequence(first, sample({ boot_id: "older", sent_at_ms: now - 1 })),
    false,
  );
});
test("CSV neutralizes formulas and escapes text correctly", () => {
  assert.equal(C.csvCell("=SUM(1,2)"), '"\'=SUM(1,2)"');
  assert.equal(C.csvCell('a"b'), '"a""b"');
  assert.equal(C.csvCell(-7.5), '"-7.5"');
});
test("grid aggregates only measured points by endpoint/source and exact bin bounds", () => {
  const rows = [
    sample(),
    sample({ sequence: 2, latency_ms: 300 }),
    sample({ broker_endpoint: "wss://other.example/mqtt" }),
    sample({ source: "demo" }),
    sample({ accuracy_m: 500 }),
  ];
  const cells = C.aggregateGrid(rows, 25);
  assert.equal(cells.length, 3);
  const cell = cells.find((c) => c.count === 2);
  assert.equal(cell.latency_mean_ms, 200);
  assert.ok(
    Math.abs(cell.latitude - (cell.bounds.south + cell.bounds.north) / 2) <
      1e-12,
  );
  assert.ok(cell.bounds.west <= 110.44 && cell.bounds.east >= 110.44);
});
test("WSS broker URL must not embed credentials, queries or fragments", () => {
  for (const url of [
    "ws://example.com/mqtt",
    "wss://user:pass@example.com/mqtt",
    "wss://example.com/mqtt?token=secret",
    "wss://example.com/#private",
  ])
    assert.equal(C.endpoint(url), null);
  assert.equal(C.endpoint("wss://example.com/mqtt"), "wss://example.com/mqtt");
});

test("Termux null sensors are not converted to measured zero", () => {
  const value = C.validateTelemetry(
    sample({
      source: "termux",
      accel_available: false,
      accel_rms: null,
      accel_mode: "unavailable",
      gyro_available: false,
      gyro_rms_rad_s: null,
      rotation_total_rad: null,
    }),
    "hp-a",
    now,
  );
  assert.equal(value.source, "termux");
  assert.equal(value.accel_rms, null);
  assert.equal(value.gyro_rms_rad_s, null);
  assert.equal(
    C.validateTelemetry(
      sample({ source: "termux", accel_mode: "unavailable" }),
      "hp-a",
      now,
    ),
    null,
  );
  assert.equal(
    C.validateTelemetry(sample({ source: "termux", probe_ok: 1 }), "hp-a", now),
    null,
  );
});
test("source filtering and grid preserve Browser/Termux separation", () => {
  const browser = sample(),
    termux = sample({ source: "termux", latency_ms: 900 });
  const rows = [browser, termux];
  assert.deepEqual(C.filterBySource(rows, "browser"), [browser]);
  assert.deepEqual(C.filterBySource(rows, "termux"), [termux]);
  assert.equal(C.filterBySource(rows, "all").length, 2);
  assert.deepEqual(C.filterBySource(rows, "invalid"), []);
  const grid = C.aggregateGrid(rows, 25);
  assert.equal(grid.length, 2);
  assert.equal(grid.find((c) => c.source === "browser").latency_mean_ms, 100);
  assert.equal(grid.find((c) => c.source === "termux").latency_mean_ms, 900);
  assert.equal(rows.length, 2);
});
