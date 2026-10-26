const test = require("node:test");
const assert = require("node:assert/strict");
const { EdgeClient } = require("../assets/edge.js");
const C = require("../assets/core.js");
function fixture() {
  let now = 0,
    nextTimer = 0;
  const timers = new Map(),
    events = new Map(),
    docEvents = new Map(),
    clients = [];
  const env = {
    isSecureContext: true,
    performance: { now: () => now },
    Date: { now: () => 1800000000000 + now },
    document: {
      hidden: false,
      addEventListener: (n, f) => docEvents.set(n, f),
      removeEventListener: (n) => docEvents.delete(n),
    },
    navigator: {
      geolocation: { watchPosition: () => 7, clearWatch: () => {} },
    },
    DeviceMotionEvent: { requestPermission: () => Promise.resolve("granted") },
    addEventListener: (n, f) => events.set(n, f),
    removeEventListener: (n) => events.delete(n),
    setTimeout: (f, delay) => {
      const id = ++nextTimer;
      timers.set(id, { f, delay, at: now + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  class Message {
    constructor(text) {
      this.payloadString = text;
    }
  }
  class Client {
    constructor() {
      this.connected = false;
      this.sent = [];
      this.subscribed = [];
      this.echo = true;
      clients.push(this);
    }
    connect(options) {
      this.options = options;
      this.connected = true;
      options.onSuccess();
    }
    subscribe(topic, options) {
      this.subscribed.push(topic);
      options.onSuccess({ grantedQos: [0] });
    }
    isConnected() {
      return this.connected;
    }
    disconnect() {
      this.connected = false;
    }
    send(message) {
      this.sent.push(message);
      if (this.echo && message.destinationName.includes("/probe/")) {
        now += 25;
        this.onMessageArrived({
          destinationName: message.destinationName,
          payloadString: message.payloadString,
          retained: false,
        });
      }
    }
  }
  env.Paho = { Client, Message };
  const states = [],
    samples = [],
    acks = [];
  const edge = new EdgeClient(
    {
      project: "team1",
      deviceId: "hp-a",
      brokerUrl: "wss://broker.example/mqtt",
    },
    {
      onState: (s) => states.push(s),
      onSample: (s) => samples.push(s),
      onAck: (a) => acks.push(a),
    },
    env,
  );
  return {
    env,
    edge,
    clients,
    timers,
    events,
    docEvents,
    states,
    samples,
    acks,
    setNow: (n) => (now = n),
    advance: (n) => (now += n),
    fireTimeout: (delay) => {
      const entry = [...timers].find(([, v]) => v.delay === delay);
      assert.ok(entry, "timer exists");
      timers.delete(entry[0]);
      entry[1].f();
    },
  };
}
const motion = (
  a = { x: 0, y: 0, z: 1 },
  g = { alpha: 0, beta: 0, gamma: 180 },
) => ({ acceleration: a, rotationRate: g });
test("permission request runs synchronously before MQTT and reentrant start is ignored", async () => {
  const f = fixture();
  let calls = 0;
  f.env.DeviceMotionEvent.requestPermission = () => {
    calls++;
    assert.equal(f.clients.length, 0);
    return Promise.resolve("granted");
  };
  const pending = f.edge.start();
  assert.equal(calls, 1);
  await f.edge.start();
  await pending;
  assert.equal(f.clients.length, 1);
  assert.equal(f.edge.ready, true);
  assert.equal(f.clients[0].subscribed.length, 2);
  f.edge.stop();
});
test("actual sensor event RMS and gyro unit conversion survive >1000 samples", async () => {
  const f = fixture();
  await f.edge.start();
  for (let i = 0; i < 1201; i++) {
    f.setNow(i * 10);
    f.edge._motion(motion());
  }
  f.setNow(12100);
  const payload = await f.edge.sampleNow();
  assert.equal(payload.accel_samples, 1201);
  assert.equal(payload.gyro_samples, 1201);
  assert.equal(payload.accel_rms, 1);
  assert.ok(Math.abs(payload.gyro_rms_rad_s - Math.PI) < 0.0001);
  assert.ok(Math.abs(payload.rotation_total_rad - 12 * Math.PI) < 0.0001);
  assert.equal(payload.gyro_covered_ms, 12000);
  assert.ok(f.edge.accel.length <= 1000);
  assert.ok(C.validateTelemetry(payload, "hp-a", f.env.Date.now()));
  f.edge.stop();
});
test("absent and stale browser sensors never fabricate zero values", async () => {
  const f = fixture();
  await f.edge.start();
  f.setNow(1000);
  const first = await f.edge.sampleNow();
  assert.equal(first.accel_rms, null);
  assert.equal(first.gyro_rms_rad_s, null);
  assert.equal(first.rotation_total_rad, null);
  f.edge._motion(motion());
  f.advance(6000);
  const second = await f.edge.sampleNow();
  assert.equal(second.accel_available, false);
  assert.equal(second.gyro_available, false);
  f.edge.stop();
});
test("nonce echo measures own MQTT app roundtrip and failed attempt stays null", async () => {
  const f = fixture();
  await f.edge.start();
  f.setNow(1000);
  const first = await f.edge.sampleNow();
  assert.equal(first.latency_ms, 25);
  assert.equal(first.latency_std_ms, null);
  assert.equal(first.success_pct, 100);
  f.clients[0].echo = false;
  f.advance(6000);
  const pending = f.edge.sampleNow();
  f.advance(5000);
  f.fireTimeout(5000);
  const failed = await pending;
  assert.equal(failed.latency_ms, null);
  assert.equal(failed.probe_ok, false);
  assert.equal(failed.latency_mean_ms, 25);
  assert.equal(failed.success_pct, 50);
  f.edge.stop();
});
test("wrong nonce and retained echo never complete a probe", async () => {
  const f = fixture();
  await f.edge.start();
  f.clients[0].echo = false;
  f.setNow(1000);
  const pending = f.edge.sampleNow();
  const send = (value, retained = false) =>
    f.clients[0].onMessageArrived({
      destinationName: f.edge.probeTopic,
      payloadString: JSON.stringify(value),
      retained,
    });
  send({ nonce: "wrong", boot_id: f.edge.bootId });
  assert.ok(f.edge.probe);
  send({ nonce: f.edge.probe.nonce, boot_id: f.edge.bootId }, true);
  assert.ok(f.edge.probe);
  f.edge.stop();
  assert.equal(await pending, null);
  assert.equal(f.timers.size, 0);
});
test("command ACK is bound to current boot and duplicate does not change interval twice", async () => {
  const f = fixture();
  await f.edge.start();
  f.setNow(2000);
  const command = {
    command_id: "cmd-1",
    device_id: "hp-a",
    target_boot_id: f.edge.bootId,
    action: "set_interval",
    interval_s: 8,
    sent_at_ms: f.env.Date.now(),
    expires_at_ms: f.env.Date.now() + 15000,
  };
  const send = (value, retained = false) =>
    f.clients[0].onMessageArrived({
      destinationName: C.topic("team1", "hp-a", "command"),
      payloadString: JSON.stringify(value),
      retained,
    });
  send({ ...command, target_boot_id: "old-boot" });
  assert.equal(f.edge.config.intervalS, 5);
  send(command, true);
  assert.equal(f.edge.config.intervalS, 5);
  send(command);
  assert.equal(f.edge.config.intervalS, 8);
  assert.equal(f.acks.length, 1);
  send({ ...command, interval_s: 10 });
  assert.equal(f.edge.config.intervalS, 8);
  assert.equal(f.acks.length, 1);
  const outbound = f.clients[0].sent.filter((m) =>
    m.destinationName.endsWith("/ack"),
  );
  assert.equal(outbound.length, 2);
  assert.equal(JSON.parse(outbound[0].payloadString).status, "ok");
  f.edge.stop();
});
test("hidden tab disconnects and cleans listeners, GPS and pending probe", async () => {
  const f = fixture();
  let clear = 0;
  f.edge.config.shareLocation = true;
  f.env.navigator.geolocation.clearWatch = (id) => {
    assert.equal(id, 7);
    clear++;
  };
  await f.edge.start();
  f.clients[0].echo = false;
  f.setNow(1000);
  const pending = f.edge.sampleNow();
  f.env.document.hidden = true;
  f.docEvents.get("visibilitychange")();
  assert.equal(await pending, null);
  assert.equal(f.edge.status, "paused");
  assert.equal(f.edge.ready, false);
  assert.equal(clear, 1);
  assert.equal(f.events.size, 0);
  assert.equal(f.docEvents.size, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.clients[0].connected, false);
});
