"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EdgeClient } = require("../assets/edge.js");
const Core = require("../assets/core.js");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function harness(options = {}) {
  const timers = new Map(),
    listeners = new Map(),
    documentListeners = new Map();
  const clients = [],
    watches = new Set();
  let tick = 1000,
    nextTimer = 0,
    permissionCalls = 0;
  const add = (map, type, fn) => {
    if (!map.has(type)) map.set(type, new Set());
    map.get(type).add(fn);
  };
  const remove = (map, type, fn) => map.get(type)?.delete(fn);
  class Message {
    constructor(payloadString) {
      this.payloadString = payloadString;
      this.retained = false;
    }
  }
  class Client {
    constructor() {
      this.connected = false;
      this.sent = [];
      this.subscriptions = [];
      this.disconnects = 0;
      clients.push(this);
    }
    connect(settings) {
      this.options = settings;
      if (options.autoConnect !== false)
        queueMicrotask(() => this.completeConnect());
    }
    completeConnect() {
      this.connected = true;
      this.options.onSuccess();
    }
    subscribe(topic, settings) {
      this.subscriptions.push(topic);
      queueMicrotask(() => settings.onSuccess({ grantedQos: [0] }));
    }
    isConnected() {
      return this.connected;
    }
    disconnect() {
      this.connected = false;
      this.disconnects++;
    }
    send(message) {
      this.sent.push(message);
      if (
        message.destinationName.includes("/probe/") &&
        options.echo !== false
      ) {
        queueMicrotask(() => {
          tick += 25;
          this.onMessageArrived(message);
        });
      }
    }
  }
  const env = {
    isSecureContext: true,
    performance: { now: () => tick },
    Date: { now: () => 1793010000000 + tick },
    setTimeout(fn, delay) {
      const id = ++nextTimer;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    addEventListener: (type, fn) => add(listeners, type, fn),
    removeEventListener: (type, fn) => remove(listeners, type, fn),
    document: {
      hidden: false,
      addEventListener: (type, fn) => add(documentListeners, type, fn),
      removeEventListener: (type, fn) => remove(documentListeners, type, fn),
    },
    navigator: {
      geolocation: {
        watchPosition() {
          watches.add(7);
          return 7;
        },
        clearWatch(id) {
          watches.delete(id);
        },
      },
    },
    DeviceMotionEvent: {
      requestPermission() {
        permissionCalls++;
        return options.permission || Promise.resolve("granted");
      },
    },
    Paho: { Client, Message },
  };
  const edge = new EdgeClient(
    {
      project: "integration",
      deviceId: "hp-a",
      brokerUrl: "wss://example.test/mqtt",
      intervalS: 5,
      shareLocation: options.shareLocation === true,
    },
    {},
    env,
  );
  return {
    edge,
    env,
    timers,
    clients,
    watches,
    options,
    advance(ms) {
      tick += ms;
    },
    permissionCalls: () => permissionCalls,
    listenerCount: () =>
      [...listeners.values(), ...documentListeners.values()].reduce(
        (sum, set) => sum + set.size,
        0,
      ),
  };
}

test("real client output passes v2 validation; unavailable sensor values stay null", async () => {
  const h = harness();
  await h.edge.start();
  h.edge._motion({
    acceleration: { x: null, y: null, z: null },
    accelerationIncludingGravity: null,
    rotationRate: { alpha: null, beta: null, gamma: null },
  });
  const sample = await h.edge.sampleNow();
  assert.equal(sample.source, "browser");
  assert.equal(sample.latency_type, "mqtt_app_rtt");
  assert.equal(sample.latency_ms, 25);
  assert.equal(sample.accel_rms, null);
  assert.equal(sample.gyro_rms_rad_s, null);
  assert.equal(sample.accel_available, false);
  assert.equal(sample.gyro_available, false);
  assert.ok(Core.validateTelemetry(sample, "hp-a", h.env.Date.now()));
  h.edge.stop();
  assert.equal(h.timers.size, 0);
  assert.equal(h.listenerCount(), 0);
});

test("measured stationary zeros are valid measurements, not fabricated missing values", async () => {
  const h = harness();
  await h.edge.start();
  const event = {
    acceleration: { x: 0, y: 0, z: 0 },
    rotationRate: { alpha: 0, beta: 0, gamma: 0 },
  };
  h.edge._motion(event);
  h.advance(100);
  h.edge._motion(event);
  const sample = await h.edge.sampleNow();
  assert.equal(sample.accel_rms, 0);
  assert.equal(sample.gyro_rms_rad_s, 0);
  assert.equal(sample.accel_available, true);
  assert.equal(sample.gyro_available, true);
  assert.ok(Core.validateTelemetry(sample, "hp-a", h.env.Date.now()));
  h.edge.stop();
});

test("rotation integral stays unknown when all event gaps are too large", async () => {
  const h = harness();
  await h.edge.start();
  const event = { rotationRate: { alpha: 90, beta: 0, gamma: 0 } };
  h.edge._motion(event);
  h.advance(1000);
  h.edge._motion(event);
  assert.equal(h.edge._snapshot().rotation_total_rad, null);
  h.edge.stop();
});

test("malformed UTF-8 getter cannot crash the MQTT message callback", async () => {
  const h = harness();
  await h.edge.start();
  const invalid = {
    retained: false,
    destinationName: h.edge.probeTopic,
    get payloadString() {
      throw new URIError("Invalid UTF-8");
    },
  };
  assert.doesNotThrow(() => h.edge._message(invalid));
  h.edge.stop();
});

test("stop cancels an in-flight probe and removes listeners, timers and GPS watch", async () => {
  const h = harness({ echo: false, shareLocation: true });
  await h.edge.start();
  const pending = h.edge.sampleNow();
  h.edge.stop();
  assert.equal(await pending, null);
  assert.equal(h.edge.active, false);
  assert.equal(h.edge.ready, false);
  assert.equal(h.timers.size, 0);
  assert.equal(h.listenerCount(), 0);
  assert.equal(h.watches.size, 0);
  assert.equal(
    h.clients[0].sent.some((m) => m.destinationName.endsWith("/telemetry")),
    false,
  );
});

test("late MQTT connection success after stop cannot revive the edge", async () => {
  const h = harness({ autoConnect: false });
  const pending = h.edge.start();
  await Promise.resolve();
  assert.equal(h.clients.length, 1);
  h.edge.stop();
  h.clients[0].completeConnect();
  await pending;
  assert.equal(h.edge.active, false);
  assert.equal(h.edge.ready, false);
  assert.equal(h.clients[0].isConnected(), false);
  assert.equal(h.clients[0].subscriptions.length, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.listenerCount(), 0);
});

test("permission is requested during start gesture; becoming hidden during prompt pauses safely", async () => {
  let grant;
  const permission = new Promise((resolve) => {
    grant = resolve;
  });
  const h = harness({ permission });
  const pending = h.edge.start();
  assert.equal(h.permissionCalls(), 1);
  h.env.document.hidden = true;
  grant("granted");
  await pending;
  assert.equal(h.edge.status, "paused");
  assert.equal(h.edge.active, false);
  assert.equal(h.clients.length, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.listenerCount(), 0);
});

test("routed commands reject retained/prior-boot messages and replay ACK without repeating effects", async () => {
  const h = harness();
  await h.edge.start();
  const command = {
    command_id: "command-one",
    device_id: "hp-a",
    target_boot_id: h.edge.bootId,
    action: "set_interval",
    interval_s: 4,
    sent_at_ms: h.env.Date.now(),
    expires_at_ms: h.env.Date.now() + 20000,
  };
  const deliver = (value, retained = false) =>
    h.edge._message({
      retained,
      destinationName: Core.topic("integration", "hp-a", "command"),
      payloadString: JSON.stringify(value),
    });
  deliver(command, true);
  assert.equal(h.edge.config.intervalS, 5);
  deliver({ ...command, target_boot_id: "old-boot" });
  assert.equal(h.edge.config.intervalS, 5);
  deliver(command);
  assert.equal(h.edge.config.intervalS, 4);
  h.advance(2500);
  deliver({ ...command, interval_s: 60 });
  assert.equal(h.edge.config.intervalS, 4);
  const acks = h.clients[0].sent
    .filter((m) => m.destinationName.endsWith("/ack"))
    .map((m) => JSON.parse(m.payloadString));
  assert.equal(acks.length, 2);
  assert.deepEqual(acks[0], acks[1]);
  h.edge.stop();
});

// A minimal DOM double exercises the actual dashboard event handlers without a browser.
function dashboardHarness() {
  class Node {
    constructor() {
      this.children = [];
      this.handlers = {};
      this.style = {};
      this.dataset = {};
      this.value = "";
      this.disabled = false;
      this.textContent = "";
      this.clientWidth = 800;
      this.clientHeight = 400;
      this.classList = { toggle() {}, add() {}, remove() {} };
    }
    append(...items) {
      this.children.push(...items);
    }
    replaceChildren(...items) {
      this.children = items;
    }
    addEventListener(type, callback) {
      this.handlers[type] = callback;
    }
    setAttribute() {}
    showModal() {
      this.open = true;
    }
    close() {
      this.open = false;
    }
    set innerHTML(_value) {
      throw new Error("Untrusted HTML sink must not be used");
    }
  }
  const nodes = new Map(),
    clients = [],
    timers = new Map();
  let nextTimer = 0;
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, new Node());
    return nodes.get(id);
  };
  const document = {
    body: Object.assign(new Node(), { dataset: { page: "dashboard" } }),
    getElementById: get,
    createElement: () => new Node(),
    createElementNS: () => new Node(),
    createTextNode: (text) => ({ textContent: text }),
    querySelectorAll: () => [],
    querySelector: (selector) => get(selector),
  };
  class Client {
    constructor() {
      this.connected = false;
      this.subscriptions = [];
      clients.push(this);
    }
    connect(settings) {
      this.options = settings;
    }
    subscribe(topic, settings) {
      this.subscriptions.push({ topic, settings });
    }
    isConnected() {
      return this.connected;
    }
    disconnect() {
      this.connected = false;
    }
    completeConnect() {
      this.connected = true;
      this.options.onSuccess();
    }
  }
  const window = {
    SigHeatCore: Core,
    Paho: { Client },
    isSecureContext: true,
    addEventListener() {},
  };
  const context = {
    window,
    document,
    URL,
    Date,
    Number,
    console,
    navigator: {},
    setInterval() {
      return 1;
    },
    setTimeout(fn, delay) {
      const id = ++nextTimer;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../assets/app.js"), "utf8"),
    context,
  );
  get("broker-url").value = "wss://example.test/mqtt";
  get("project-id").value = "integration";
  return {
    get,
    clients,
    submit() {
      get("connection-form").handlers.submit({ preventDefault() {} });
    },
  };
}

test("dashboard rejects failed SUBACK and restores the connect control", () => {
  const h = dashboardHarness();
  h.submit();
  const client = h.clients[0];
  client.completeConnect();
  assert.equal(client.subscriptions.length, 3);
  client.subscriptions[0].settings.onSuccess({ grantedQos: [128] });
  assert.equal(h.get("connect-button").disabled, false);
  assert.notEqual(h.get("mode-chip").textContent, "BROKER TERHUBUNG");
});

test("dashboard loss during setup restores retry rather than leaving connecting disabled", () => {
  const h = dashboardHarness();
  h.submit();
  assert.equal(h.get("connect-button").disabled, true);
  h.clients[0].onConnectionLost({ errorCode: 8 });
  assert.equal(h.get("connect-button").disabled, false);
  assert.notEqual(h.get("mode-chip").textContent, "BROKER TERHUBUNG");
});

test("closing the connection dialog cancels late dashboard connection callbacks", () => {
  const h = dashboardHarness();
  h.submit();
  h.get("connection-dialog").handlers.cancel({ preventDefault() {} });
  h.clients[0].completeConnect();
  assert.equal(h.clients[0].connected, false);
  assert.equal(h.clients[0].subscriptions.length, 0);
  assert.equal(h.get("connect-button").disabled, false);
});
