const test = require('node:test');
const assert = require('node:assert/strict');
const { EdgeClient } = require('../assets/edge.js');
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  const timers = new Map(), events = new Map(), docs = new Map(), clients = [], states = [];
  let timerId = 0, permissions = 0, releases = 0, requests = 0, rejectConnection = false;
  class Client {
    constructor() { clients.push(this); this.connected = false; this.sent = []; }
    connect(options) {
      if (rejectConnection) { options.onFailure({}); return; }
      this.connected = true; options.onSuccess();
    }
    subscribe(topic, options) { options.onSuccess({ grantedQos: [0] }); }
    isConnected() { return this.connected; }
    disconnect() { this.connected = false; }
    send(message) { this.sent.push(message); }
  }
  const env = {
    isSecureContext: true, Date: { now: () => 1800000000000 }, performance: { now: () => 100 },
    document: { hidden: false, addEventListener: (n, f) => docs.set(n, f), removeEventListener: n => docs.delete(n) },
    addEventListener: (n, f) => events.set(n, f), removeEventListener: n => events.delete(n),
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    DeviceMotionEvent: { requestPermission: () => { permissions++; return Promise.resolve('granted'); } },
    navigator: { wakeLock: { request: async () => { requests++; return { release: async () => { releases++; }, addEventListener() {} }; } } },
    Paho: { Client, Message: class { constructor(payload) { this.payloadString = payload; } } },
  };
  const edge = new EdgeClient({ project: 'team1', deviceId: 'hp-a', brokerUrl: 'wss://broker.example/mqtt' }, { onState: s => states.push(s) }, env);
  return { edge, env, timers, events, docs, clients, states, counts: () => ({ permissions, requests, releases }),
    reject: value => { rejectConnection = value; },
    fire(delay) { const pair = [...timers].find(([, x]) => x.delay === delay); assert.ok(pair); timers.delete(pair[0]); pair[1].fn(); },
    hide(value) { env.document.hidden = value; docs.get('visibilitychange')(); },
  };
}

test('visible return resumes with fresh boot and granted sensors without another permission prompt', async () => {
  const h = harness(); await h.edge.start(); await flush();
  const firstBoot = h.edge.bootId;
  h.hide(true);
  assert.equal(h.edge.ready, false);
  assert.equal(h.edge.desiredRunning, true);
  assert.equal(h.edge.status, 'paused');
  assert.equal(h.counts().releases, 1);
  assert.equal(h.timers.size, 0);
  h.hide(false); await flush();
  assert.equal(h.edge.ready, true);
  assert.notEqual(h.edge.bootId, firstBoot);
  assert.equal(h.edge.sequence, 0);
  assert.equal(h.counts().permissions, 1);
  assert.equal(h.counts().requests, 2);
  assert.ok(h.events.has('devicemotion'));
  h.edge.stop();
  assert.equal(h.events.size + h.docs.size + h.timers.size, 0);
  assert.equal(h.counts().releases, 2);
});

test('transport loss cancels pending probe and reconnect backoff caps at 30 seconds', async () => {
  const h = harness(); await h.edge.start();
  const pending = h.edge.sampleNow();
  h.reject(true);
  h.clients[0].connected = false;
  h.clients[0].onConnectionLost({ errorCode: 8 });
  assert.equal(await pending, null);
  assert.equal(h.edge.ready, false);
  assert.equal(h.edge.status, 'reconnecting');
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    assert.equal([...h.timers.values()].filter(x => x.delay === delay).length, 1);
    h.fire(delay); await flush();
    assert.equal(h.edge.ready, false);
  }
  assert.ok(h.clients.every(c => c.sent.every(m => !m.destinationName.endsWith('/telemetry'))));
  h.reject(false); h.events.get('online')(); await flush();
  assert.equal(h.edge.ready, true);
  assert.equal(h.edge.retryAttempt, 0);
  h.edge.stop();
  assert.equal(h.timers.size, 0);
});

test('manual stop and page close never auto-reconnect; stale callbacks cannot revive a session', async () => {
  const h = harness(); await h.edge.start();
  const previous = h.clients[0];
  h.events.get('pagehide')();
  previous.onConnectionLost({});
  assert.equal(h.edge.desiredRunning, false);
  assert.equal(h.edge.ready, false);
  assert.equal(h.events.size + h.docs.size + h.timers.size, 0);
});

test('wake lock denial or missing API never pretends to keep screen awake or blocks RTT', async () => {
  const h = harness();
  const notices = [];
  h.edge.callbacks.onWakeLock = s => notices.push(s);
  h.env.navigator.wakeLock.request = async () => { throw new Error('Denied'); };
  await h.edge.start(); await flush();
  assert.equal(h.edge.ready, true);
  assert.equal(h.edge.wakeLock, null);
  assert.ok(notices.some(x => x.includes('tidak mengizinkan')));
  h.edge.stop();
  delete h.env.navigator.wakeLock;
  await h.edge.start();
  assert.equal(h.edge.ready, true);
  assert.equal(h.edge.wakeLock, null);
  h.edge.stop();
});

test('wake lock granted after stop is immediately released', async () => {
  const h = harness(); let grant, released = 0;
  h.env.navigator.wakeLock.request = () => new Promise(resolve => { grant = resolve; });
  await h.edge.start(); h.edge.stop();
  grant({ release: async () => { released++; }, addEventListener() {} });
  await flush();
  assert.equal(released, 1);
  assert.equal(h.edge.wakeLock, null);
  assert.equal(h.edge.ready, false);
});
