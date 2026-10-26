'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const C = require('../assets/core.js');
const root = path.resolve(__dirname, '..');
const now = Date.now();
const script = `import json, math, sys
from termux_edge import Config, TermuxEdge
from termux_sensors import TermuxSensors
from termux_processing import GRAVITY
now = json.load(sys.stdin)['now']
sensor = TermuxSensors('Accel', 'Gyro', clock=lambda: .4)
sensor.consume({'Accel': {'values': [0, 0, GRAVITY + 1]}}, 0)
sensor.consume({'Gyro': {'values': [0, 0, math.pi]}}, .1)
sensor.consume({'Gyro': {'values': [0, 0, math.pi]}}, .3)
edge = TermuxEdge(Config('py-a', 'integration', 'wss://EXAMPLE.TEST:443/mqtt'), sensor, clock=lambda: .4, wall=lambda: now / 1000, logger=lambda message: None)
first = edge.make_payload(45.5)
second = edge.make_payload(None)
print(json.dumps([first, second], allow_nan=False))
`;
let python = process.env.PYTHON || 'python3';
if (spawnSync(python, ['--version']).error && !process.env.PYTHON) python = 'python';
const execution = spawnSync(python, ['-c', script], {cwd: root, input: JSON.stringify({now}), encoding: 'utf8'});
assert.equal(execution.status, 0, `Python contract fixture failed: ${execution.stderr || execution.error}`);
const [termux, termuxAfterFailure] = JSON.parse(execution.stdout);

test('actual Python Termux payload validates in JavaScript with canonical WSS endpoint and SI units', () => {
  const value = C.validateTelemetry(termux, 'py-a', now);
  assert.ok(value);
  assert.equal(value.source, 'termux');
  assert.equal(value.broker_endpoint, C.endpoint('wss://EXAMPLE.TEST:443/mqtt'));
  assert.equal(value.broker_endpoint, 'wss://example.test/mqtt');
  assert.equal(value.latency_ms, 45.5);
  assert.equal(value.accel_rms, 1);
  assert.ok(Math.abs(value.gyro_rms_rad_s - Math.PI) < 0.0001);
  assert.ok(Math.abs(value.rotation_total_rad - Math.PI * .2) < 0.0001);
});

test('Python missing fresh sensors and failed echo remain null across the language boundary', () => {
  const value = C.validateTelemetry(termuxAfterFailure, 'py-a', now);
  assert.ok(value);
  assert.equal(value.latency_ms, null);
  assert.equal(value.probe_ok, false);
  assert.equal(value.accel_rms, null);
  assert.equal(value.gyro_rms_rad_s, null);
  assert.equal(value.accel_available, false);
  assert.equal(value.gyro_available, false);
  assert.equal(value.success_pct, 50);
  assert.equal(value.latency_mean_ms, 45.5);
});

test('wire rejects demo and wrong metric claims; source filters separate both acquisition paths', () => {
  assert.equal(C.validateTelemetry({...termux, source: 'demo'}, 'py-a', now), null);
  assert.equal(C.validateTelemetry({...termux, latency_type: 'rssi_dbm'}, 'py-a', now), null);
  assert.equal(C.validateTelemetry({...termux, accel_mode: 'unavailable'}, 'py-a', now), null);
  const browser = {...termux, source: 'browser', device_id: 'web-a'};
  assert.ok(C.validateTelemetry(browser, 'web-a', now));
  assert.deepEqual(C.filterBySource([termux, browser], 'termux'), [termux]);
  assert.deepEqual(C.filterBySource([termux, browser], 'browser'), [browser]);
});

function dashboardHarness() {
  class Node {
    constructor() {this.children=[];this.handlers={};this.style={};this.dataset={};this.options=[{}];this.value='';this.disabled=false;this.textContent='';this.clientWidth=800;this.clientHeight=400;this.classList={toggle(){},add(){},remove(){}};}
    append(...items){this.children.push(...items);} replaceChildren(...items){this.children=items;}
    addEventListener(type, fn){this.handlers[type]=fn;} setAttribute(){} showModal(){this.open=true;} close(){this.open=false;}
    set innerHTML(_){throw new Error('Unsafe HTML sink');}
  }
  const nodes=new Map(),clients=[];
  const get=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
  const document={body:Object.assign(new Node(),{dataset:{page:'dashboard'}}),getElementById:get,createElement:()=>new Node(),createElementNS:()=>new Node(),createTextNode:text=>({textContent:text}),querySelectorAll:()=>[],querySelector:get};
  class Message {constructor(payloadString){this.payloadString=payloadString;}}
  class Client {
    constructor(){this.connected=false;this.subscriptions=[];this.sent=[];clients.push(this);}
    connect(options){this.options=options;} isConnected(){return this.connected;} disconnect(){this.connected=false;}
    subscribe(topic,options){this.subscriptions.push({topic,options});options.onSuccess({grantedQos:[1]});}
    send(message){this.sent.push(message);}
  }
  const window={SigHeatCore:C,Paho:{Client,Message},isSecureContext:true,addEventListener(){}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'assets/app.js'),'utf8'),{window,document,URL,Date,Number,console,navigator:{},setInterval(){return 1;},setTimeout(){return 1;},clearTimeout(){}});
  get('broker-url').value='wss://example.test:443/mqtt';get('project-id').value='integration';
  get('connection-form').handlers.submit({preventDefault(){}});
  const client=clients[0];client.connected=true;client.options.onSuccess();
  return {get,client,receive(payload){client.onMessageArrived({retained:false,destinationName:C.topic('integration',payload.device_id,'telemetry'),payloadString:JSON.stringify(payload)});}};
}

test('mixed dashboard suppresses aggregate grid and command target follows source filter', () => {
  const h=dashboardHarness();
  h.receive({...termux,sent_at_ms:Date.now()});
  h.receive({...termux,source:'browser',device_id:'web-a',boot_id:'browser-boot',sent_at_ms:Date.now()});
  assert.equal(h.get('map-grid').disabled,true);
  assert.match(h.get('metric-rssi-note').textContent,/Pilih satu sumber/);
  h.get('source-filter').value='browser';h.get('source-filter').handlers.change({target:h.get('source-filter')});
  assert.equal(h.get('detail-name').textContent,'web-a');
  assert.equal(h.get('detail-source').textContent,'Browser');
  assert.equal(h.get('map-grid').disabled,false);
  h.get('sample-now').handlers.click();
  assert.equal(h.client.sent.length,1);
  const command=JSON.parse(h.client.sent[0].payloadString);
  assert.equal(command.device_id,'web-a');assert.equal(command.target_boot_id,'browser-boot');
  h.get('source-filter').value='termux';h.get('source-filter').handlers.change({target:h.get('source-filter')});
  assert.equal(h.get('detail-name').textContent,'py-a');
  h.get('sample-now').handlers.click();
  assert.equal(JSON.parse(h.client.sent[1].payloadString).device_id,'py-a');
});

test('demo-shaped telemetry cannot enter the connected mixed-source dashboard', () => {
  const h=dashboardHarness();
  h.receive({...termux,source:'demo',sent_at_ms:Date.now()});
  assert.equal(h.get('nav-device-count').textContent,0);
  assert.equal(h.client.sent.length,0);
});
