#!/usr/bin/env python3
"""SigHeat option B: Termux motion sensors + the same MQTT/WSS v2 dashboard protocol."""
import argparse
from collections import OrderedDict
from dataclasses import dataclass, field
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import threading
import time
from urllib.parse import urlsplit, unquote
from termux_processing import ProbeWindow, number
from termux_sensors import TermuxSensors, discover_sensors

ID = re.compile(r'^[A-Za-z0-9_-]{1,48}$')


def valid_id(value):
    return isinstance(value, str) and ID.fullmatch(value) is not None


def canonical_endpoint(value):
    """Match browser URL normalization for supported WSS endpoints; never embed secrets."""
    try:
        if not isinstance(value, str) or any(c.isspace() for c in value) or '\\' in value:
            raise ValueError
        url = urlsplit(value)
        if url.scheme.lower() != 'wss' or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise ValueError
        host = url.hostname.lower().encode('idna').decode('ascii')
        if ':' in host:
            host = '[' + ipaddress.IPv6Address(host).compressed + ']'
        port = url.port if url.port is not None else 443
        if not 1 <= port <= 65535:
            raise ValueError
        path = url.path or '/'
        if any(segment in ('.', '..') for segment in unquote(path).split('/')) or not re.fullmatch(r"/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*", path):
            raise ValueError
        return f'wss://{host}{":" + str(port) if port != 443 else ""}{path}'
    except (ValueError, UnicodeError) as exc:
        raise ValueError('MQTT_WSS_URL harus wss://host/path tanpa user, password, query, atau fragment.') from exc


@dataclass
class Config:
    device_id: str
    project: str
    endpoint: str = 'wss://broker.hivemq.com:8884/mqtt'
    username: str = ''
    password: str = field(default='', repr=False)
    interval_s: float = 5

    def __post_init__(self):
        if not valid_id(self.device_id) or not valid_id(self.project):
            raise ValueError('Device ID dan PROJECT_ID harus 1–48 huruf, angka, tanda - atau _.')
        self.endpoint = canonical_endpoint(self.endpoint)
        if number(self.interval_s, 2, 60) is None:
            raise ValueError('INTERVAL_S harus angka 2–60 detik.')


def validate_command(raw, device_id, boot_id, now_ms, retained=False):
    if retained or not isinstance(raw, (bytes, str)) or len(raw) > 16384:
        return None
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeError, RecursionError):
        return None
    if not isinstance(data, dict) or not valid_id(data.get('command_id')):
        return None
    if data.get('device_id') != device_id or data.get('target_boot_id') != boot_id:
        return None
    if data.get('action') not in ('sample_now', 'set_interval'):
        return None
    sent = number(data.get('sent_at_ms'), now_ms - 30000, now_ms + 5000)
    expires = number(data.get('expires_at_ms'), now_ms, now_ms + 35000)
    if sent is None or expires is None or not 0 < expires - sent <= 30000:
        return None
    if data['action'] == 'set_interval' and number(data.get('interval_s'), 2, 60) is None:
        return None
    return data


class TermuxEdge:
    """Paho network callbacks never block on sensors or a probe; sampling runs in main."""
    def __init__(self, config, sensors, mqtt_module=None, clock=time.monotonic, wall=time.time, logger=print):
        self.config, self.sensors, self.mqtt = config, sensors, mqtt_module
        self.clock, self.wall, self.log = clock, wall, logger
        self.boot_id = 'boot-' + secrets.token_hex(12)
        self.sequence = 0
        self.base = f'sigheat/{config.project}/edge/{config.device_id}'
        self.probe_topic = f'sigheat/{config.project}/probe/{self.boot_id}'
        self.probes = ProbeWindow()
        self.client = None
        self.ready = threading.Event()
        self.setup_done = threading.Event()
        self.stopped = threading.Event()
        self.wake = threading.Event()
        self.probe_event = threading.Event()
        self.lock = threading.RLock()
        self.pending = None
        self.subscribe_mid = None
        self.recent = OrderedDict()
        self.last_command = self.last_sample = -float('inf')
        self.failure = None

    def timestamp(self):
        return int(self.wall() * 1000)

    def status(self, online):
        return {'schema_version': 2, 'device_id': self.config.device_id, 'boot_id': self.boot_id,
                'source': 'termux', 'online': online, 'sent_at_ms': self.timestamp()}

    def _publish(self, topic, payload, retained=False):
        if self.client is None or not self.client.is_connected():
            return False
        try:
            info = self.client.publish(topic, json.dumps(payload, allow_nan=False), qos=0, retain=retained)
            return info.rc == 0
        except (ValueError, RuntimeError):
            return False

    def _fail(self, message):
        self.failure = message
        self.ready.clear()
        self.stopped.set()
        self.setup_done.set()
        self.wake.set()
        self.probe_event.set()

    def connect(self):
        if self.mqtt is None:
            import paho.mqtt.client as mqtt
            self.mqtt = mqtt
        mqtt = self.mqtt
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
            client_id='sigheat-' + secrets.token_hex(10), clean_session=True,
            protocol=mqtt.MQTTv311, transport='websockets', reconnect_on_failure=False)
        parsed = urlsplit(self.config.endpoint)
        self.client.ws_set_options(path=parsed.path or '/')
        self.client.tls_set()  # Trusted CA + hostname verification enabled, never tls_insecure_set.
        if self.config.username:
            self.client.username_pw_set(self.config.username, self.config.password)
        self.client.max_queued_messages_set(20)
        self.client.will_set(self.base + '/status', json.dumps(self.status(False)), qos=0, retain=True)
        self.client.on_connect = self.on_connect
        self.client.on_connect_fail = lambda client, userdata: self._fail('Broker tidak terjangkau.')
        self.client.on_subscribe = self.on_subscribe
        self.client.on_message = self.on_message
        self.client.on_disconnect = self.on_disconnect
        self.client.connect_async(parsed.hostname, parsed.port or 443, keepalive=30)
        self.client.loop_start()

    def on_connect(self, client, userdata, flags, reason, properties):
        if self.stopped.is_set():
            client.disconnect()
            return
        if reason.is_failure:
            self._fail('Koneksi MQTT ditolak. Periksa alamat, akun, dan ACL.')
            return
        result, mid = client.subscribe([(self.probe_topic, 0), (self.base + '/command', 0)])
        self.subscribe_mid = mid
        if result != 0:
            self._fail('Permintaan subscribe gagal.')

    def on_subscribe(self, client, userdata, mid, reasons, properties):
        if self.stopped.is_set() or mid != self.subscribe_mid:
            return
        if len(reasons) != 2 or any(reason.is_failure for reason in reasons):
            self._fail('Broker menolak langganan probe atau command.')
            return
        self.ready.set()
        self.setup_done.set()
        self._publish(self.base + '/status', self.status(True), retained=True)
        self.log('MQTT WSS siap: langganan probe dan command dikonfirmasi.')

    def on_disconnect(self, client, userdata, flags, reason, properties):
        if not self.stopped.is_set():
            self._fail('Koneksi MQTT terputus. Jalankan ulang setelah jaringan pulih.')

    def on_message(self, client, userdata, message):
        if self.stopped.is_set() or message.retain or len(message.payload) > 16384:
            return
        if message.topic == self.probe_topic:
            try:
                value = json.loads(message.payload)
            except (ValueError, UnicodeError, RecursionError):
                return
            if not isinstance(value, dict):
                return
            with self.lock:
                if self.pending and self.pending['latency'] is None and self.clock() <= self.pending['deadline'] and value.get('nonce') == self.pending['nonce'] and value.get('boot_id') == self.boot_id:
                    self.pending['latency'] = (self.clock() - self.pending['started']) * 1000
                    self.probe_event.set()
            return
        if message.topic != self.base + '/command':
            return
        command = validate_command(message.payload, self.config.device_id, self.boot_id, self.timestamp())
        if command is None:
            return
        cid = command['command_id']
        if cid in self.recent:
            self._publish(self.base + '/ack', self.recent[cid])
            return
        ack = {'schema_version': 2, 'command_id': cid, 'device_id': self.config.device_id,
               'boot_id': self.boot_id, 'action': command['action'], 'status': 'error',
               'message': '', 'sent_at_ms': self.timestamp()}
        now = self.clock()
        with self.lock:
            if not self.ready.is_set() or now - self.last_command < 2:
                ack['message'] = 'Tunggu dua detik sebelum perintah berikutnya.'
            elif command['action'] == 'sample_now' and (self.pending or now - self.last_sample < 2):
                ack['message'] = 'Pengukuran masih berjalan. Tunggu telemetri berikutnya.'
            else:
                self.last_command = now
                ack['status'] = 'ok'
                if command['action'] == 'set_interval':
                    self.config.interval_s = command['interval_s']
                    ack.update(interval_s=self.config.interval_s, message='Interval diperbarui.')
                else:
                    ack['message'] = 'Pengukuran diminta. Tunggu telemetri berikutnya.'
                self.wake.set()
        self.recent[cid] = ack
        if len(self.recent) > 100:
            self.recent.popitem(last=False)
        self._publish(self.base + '/ack', ack)

    def measure_probe(self, timeout=5):
        with self.lock:
            if self.pending is not None or not self.ready.is_set() or self.stopped.is_set():
                return None
            self.last_sample = self.clock()
            self.probe_event.clear()
            self.pending = {'nonce': secrets.token_hex(16), 'started': self.clock(), 'deadline': self.clock() + timeout, 'latency': None}
            payload = {'nonce': self.pending['nonce'], 'boot_id': self.boot_id}
        if self._publish(self.probe_topic, payload):
            self.probe_event.wait(timeout)
        with self.lock:
            latency = self.pending['latency'] if self.pending else None
            self.pending = None
        return latency

    def make_payload(self, latency_ms):
        self.sequence += 1
        metrics = self.probes.add(latency_ms)
        sensors = self.sensors.snapshot()
        if not metrics['probe_ok']:
            sensors['sensor_errors'].append('mqtt_probe_timeout_or_failed')
        return {
            'schema_version': 2, 'source': 'termux', 'device_id': self.config.device_id,
            'boot_id': self.boot_id, 'sequence': self.sequence, 'sent_at_ms': self.timestamp(),
            'interval_s': self.config.interval_s, 'latency_type': 'mqtt_app_rtt',
            'broker_endpoint': self.config.endpoint, **metrics, **sensors,
        }

    def run(self):
        try:
            self.sensors.start()
            self.connect()
            if not self.setup_done.wait(15) or not self.ready.is_set():
                raise RuntimeError(self.failure or 'Broker tidak memberikan SUBACK dalam 15 detik.')
            next_sample = self.clock() + .5
            while not self.stopped.is_set():
                self.wake.wait(max(0, next_sample - self.clock()))
                self.wake.clear()
                if self.stopped.is_set():
                    break
                if self.clock() - self.last_sample < 2:
                    next_sample = self.last_sample + 2
                    continue
                latency = self.measure_probe()
                if self.stopped.is_set():
                    break
                payload = self.make_payload(latency)
                self._publish(self.base + '/telemetry', payload)
                self.log(f"#{self.sequence} RTT={payload['latency_ms']} ms | "
                         f"accel={payload['accel_available']} gyro={payload['gyro_available']} | "
                         f"errors={','.join(payload['sensor_errors']) or 'none'}")
                next_sample = self.last_sample + self.config.interval_s
            if self.failure:
                raise RuntimeError(self.failure)
        finally:
            self.stop()

    def stop(self):
        self.stopped.set()
        self.ready.clear()
        self.wake.set()
        self.probe_event.set()
        try:
            if self.client:
                self._publish(self.base + '/status', self.status(False), retained=True)
                try:
                    self.client.disconnect()
                finally:
                    self.client.loop_stop()
        finally:
            self.sensors.stop()


def check_sensors(accelerometer=None, gyroscope=None):
    accel, gyro = discover_sensors(accelerometer, gyroscope)
    print(f'Accelerometer: {accel}\nGyroscope: {gyro}\nMembaca sensor lokal; tidak menghubungi broker...')
    sensors = TermuxSensors(accel, gyro)
    try:
        sensors.start()
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            a, g = sensors.processing.counts()
            if a >= 2 and g >= 2:
                break
            time.sleep(.1)
        result = sensors.snapshot()
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 0 if result['accel_available'] and result['gyro_available'] and result['rotation_total_rad'] is not None else 2
    finally:
        sensors.stop()


def main(argv=None):
    try:
        from dotenv import load_dotenv
        load_dotenv(Path(__file__).with_name('.env'))
    except ImportError:
        pass  # --check-sensors needs only Python standard library and Termux:API.
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('device_id', nargs='?', default='hp-a')
    parser.add_argument('--check-sensors', action='store_true', help='Diagnostik lokal, tanpa broker/internet')
    parser.add_argument('--project', default=os.getenv('PROJECT_ID', ''))
    parser.add_argument('--broker-url', default=os.getenv('MQTT_WSS_URL', 'wss://broker.hivemq.com:8884/mqtt'))
    parser.add_argument('--interval', type=float, default=os.getenv('INTERVAL_S', '5'))
    parser.add_argument('--share-location', action='store_true', help='Izinkan koordinat GPS dikirim ke broker')
    parser.add_argument('--accelerometer', help='Nama sensor persis dari termux-sensor -l')
    parser.add_argument('--gyroscope', help='Nama sensor persis dari termux-sensor -l')
    args = parser.parse_args(argv)
    try:
        if args.check_sensors:
            return check_sensors(args.accelerometer, args.gyroscope)
        config = Config(args.device_id, args.project, args.broker_url,
                        os.getenv('MQTT_USERNAME', ''), os.getenv('MQTT_PASSWORD', ''), args.interval)
        accel, gyro = discover_sensors(args.accelerometer, args.gyroscope)
        sensors = TermuxSensors(accel, gyro, args.share_location)
        print(f'SigHeat Termux | {config.device_id} | RTT aplikasi MQTT, bukan RSSI/dBm.')
        if args.share_location:
            print('Berbagi GPS aktif. Broker publik dapat dibaca pihak lain.')
        TermuxEdge(config, sensors).run()
        return 0
    except KeyboardInterrupt:
        print('Pengukuran dihentikan.')
        return 0
    except ImportError:
        print('Pasang dependensi: python -m pip install -r requirements.txt')
        return 2
    except (RuntimeError, ValueError, OSError) as error:
        print(f'Gagal: {error}')
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
